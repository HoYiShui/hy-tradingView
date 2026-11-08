import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  Candle,
  Day,
  DailyPnl,
  EquityPoint,
  EquityRange,
  Fill,
  MarketSymbol,
  Millis,
  Price,
  Qty,
  Usd,
  type CandleInterval,
} from "@hy/types";
import type { FundingPayment, PositionRecord } from "./backpack/parse.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS candles (
  symbol TEXT NOT NULL, interval TEXT NOT NULL, start_ms INTEGER NOT NULL,
  open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL, close REAL NOT NULL, volume REAL NOT NULL,
  PRIMARY KEY (symbol, interval, start_ms)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS fills (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL, symbol TEXT NOT NULL, side TEXT NOT NULL,
  price REAL NOT NULL, quantity REAL NOT NULL, fee REAL NOT NULL, liquidity TEXT NOT NULL, at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS fills_at ON fills (at_ms);
CREATE TABLE IF NOT EXISTS funding (
  symbol TEXT NOT NULL, at_ms INTEGER NOT NULL, amount REAL NOT NULL, rate REAL NOT NULL,
  PRIMARY KEY (symbol, at_ms)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS equity_snapshots (
  ts INTEGER PRIMARY KEY, equity REAL NOT NULL, open_pnl REAL NOT NULL, notional REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS positions (
  id TEXT PRIMARY KEY, symbol TEXT NOT NULL, opened_ms INTEGER NOT NULL, closed_ms INTEGER,
  realized REAL NOT NULL, fees REAL NOT NULL, funding REAL NOT NULL
);
`;

const DAILY_PNL_SQL = `
WITH events AS (
  SELECT closed_ms AS at_ms, realized AS trading, 0.0 AS funding FROM positions WHERE closed_ms IS NOT NULL
  UNION ALL
  SELECT at_ms, 0.0, amount FROM funding
), daily AS (
  SELECT date(at_ms / 1000, 'unixepoch') AS day, SUM(trading) AS trading, SUM(funding) AS funding
  FROM events GROUP BY day
)
SELECT day, trading, funding, trading + funding AS total,
       SUM(trading + funding) OVER (ORDER BY day) AS cumulative
FROM daily ORDER BY day
`;

const EQUITY_SQL = `
SELECT ts, equity, open_pnl, notional FROM equity_snapshots
WHERE ts IN (SELECT MAX(ts) FROM equity_snapshots WHERE ts >= ?1 GROUP BY ts / CAST(?2 AS INTEGER))
ORDER BY ts
`;

export const EQUITY_BUCKET_MS = 5 * 60_000;
export const EQUITY_MAX_POINTS = 600;
const RANGE_MS: Record<Exclude<EquityRange, "all">, number> = {
  "1d": 86_400_000,
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
};

export function equityBucket(ts: number): number {
  return Math.floor(ts / EQUITY_BUCKET_MS) * EQUITY_BUCKET_MS;
}

export function downsampleStep(spanMs: number): number {
  const raw = Math.ceil(spanMs / EQUITY_MAX_POINTS);
  return Math.max(EQUITY_BUCKET_MS, Math.ceil(raw / EQUITY_BUCKET_MS) * EQUITY_BUCKET_MS);
}

type Row = Record<string, string | number | null>;

export type Store = ReturnType<typeof openStore>;

export function openStore(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA);

  const upsertCandle = db.prepare(
    `INSERT INTO candles VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (symbol, interval, start_ms) DO UPDATE SET
       open = excluded.open, high = excluded.high, low = excluded.low, close = excluded.close, volume = excluded.volume`,
  );
  const upsertFill = db.prepare(`INSERT OR REPLACE INTO fills VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const upsertFunding = db.prepare(`INSERT OR REPLACE INTO funding VALUES (?, ?, ?, ?)`);
  const upsertPosition = db.prepare(`INSERT OR REPLACE INTO positions VALUES (?, ?, ?, ?, ?, ?, ?)`);

  function inTransaction(work: () => void): void {
    db.exec("BEGIN");
    try {
      work();
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }

  const candleOf = (r: Row): Candle => ({
    start: Millis.parse(r.start_ms),
    open: Price.parse(r.open),
    high: Price.parse(r.high),
    low: Price.parse(r.low),
    close: Price.parse(r.close),
    volume: Qty.parse(r.volume),
  });

  const fillOf = (r: Row): Fill => ({
    id: String(r.id),
    orderId: String(r.order_id),
    symbol: MarketSymbol.parse(r.symbol),
    side: r.side === "buy" ? "buy" : "sell",
    price: Price.parse(r.price),
    quantity: Qty.parse(r.quantity),
    fee: Usd.parse(r.fee),
    liquidity: r.liquidity === "maker" ? "maker" : "taker",
    at: Millis.parse(r.at_ms),
  });

  return {
    saveCandles(symbol: MarketSymbol, interval: CandleInterval, candles: readonly Candle[]): void {
      inTransaction(() => {
        for (const c of candles) upsertCandle.run(symbol, interval, c.start, c.open, c.high, c.low, c.close, c.volume);
      });
    },
    candles(input: { symbol: MarketSymbol; interval: CandleInterval; since: Millis | null; limit: number }): Candle[] {
      const rows = (
        input.since === null
          ? db
              .prepare(
                `SELECT * FROM (SELECT * FROM candles WHERE symbol = ? AND interval = ? ORDER BY start_ms DESC LIMIT ?) ORDER BY start_ms`,
              )
              .all(input.symbol, input.interval, input.limit)
          : db
              .prepare(
                `SELECT * FROM candles WHERE symbol = ? AND interval = ? AND start_ms >= ? ORDER BY start_ms LIMIT ?`,
              )
              .all(input.symbol, input.interval, input.since, input.limit)
      ) as Row[];
      return rows.map(candleOf);
    },
    latestCandleStart(symbol: MarketSymbol, interval: CandleInterval): Millis | null {
      const row = db
        .prepare(`SELECT MAX(start_ms) AS m FROM candles WHERE symbol = ? AND interval = ?`)
        .get(symbol, interval) as Row | undefined;
      return row?.m == null ? null : Millis.parse(row.m);
    },
    saveFills(fills: readonly Fill[]): void {
      inTransaction(() => {
        for (const f of fills)
          upsertFill.run(f.id, f.orderId, f.symbol, f.side, f.price, f.quantity, f.fee, f.liquidity, f.at);
      });
    },
    fills(limit: number): Fill[] {
      return (db.prepare(`SELECT * FROM fills ORDER BY at_ms DESC, id DESC LIMIT ?`).all(limit) as Row[]).map(fillOf);
    },
    latestFillAt(): Millis | null {
      const row = db.prepare(`SELECT MAX(at_ms) AS m FROM fills`).get() as Row | undefined;
      return row?.m == null ? null : Millis.parse(row.m);
    },
    saveFunding(payments: readonly FundingPayment[]): void {
      inTransaction(() => {
        for (const p of payments) upsertFunding.run(p.symbol, p.at, p.amount, p.rate);
      });
    },
    latestFundingAt(): Millis | null {
      const row = db.prepare(`SELECT MAX(at_ms) AS m FROM funding`).get() as Row | undefined;
      return row?.m == null ? null : Millis.parse(row.m);
    },
    savePositions(records: readonly PositionRecord[]): void {
      inTransaction(() => {
        for (const r of records)
          upsertPosition.run(r.id, r.symbol, r.openedAt, r.closedAt, r.realizedPnl, r.fees, r.funding);
      });
    },
    dailyPnl(): DailyPnl[] {
      return (db.prepare(DAILY_PNL_SQL).all() as Row[]).map((r) => ({
        day: Day.parse(r.day),
        trading: Usd.parse(r.trading),
        funding: Usd.parse(r.funding),
        total: Usd.parse(r.total),
        cumulative: Usd.parse(r.cumulative),
      }));
    },
    saveEquity(point: EquityPoint): void {
      db.prepare(`INSERT OR REPLACE INTO equity_snapshots VALUES (?, ?, ?, ?)`).run(
        equityBucket(point.ts),
        point.equity,
        point.openPnl,
        point.notional,
      );
    },
    equity(range: EquityRange, now: number): EquityPoint[] {
      const since = range === "all" ? 0 : now - RANGE_MS[range];
      const first = db.prepare(`SELECT MIN(ts) AS m FROM equity_snapshots WHERE ts >= ?`).get(since) as Row | undefined;
      const span = first?.m == null ? 0 : now - Number(first.m);
      const rows = db.prepare(EQUITY_SQL).all(since, downsampleStep(span)) as Row[];
      return rows.map((r) => ({
        ts: Millis.parse(r.ts),
        equity: Usd.parse(r.equity),
        openPnl: Usd.parse(r.open_pnl),
        notional: Usd.parse(r.notional),
      }));
    },
    close(): void {
      db.close();
    },
  };
}
