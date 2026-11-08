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
  OrderRecord,
  OrderStatus,
  Qty,
  Transfer,
  Usd,
  type CandleInterval,
} from "@hy/types";
import { mergeRanges, type Range } from "./coverage.js";
import type { FundingPayment, PositionRecord } from "./exchange.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS candles (
  symbol TEXT NOT NULL, interval TEXT NOT NULL, start_ms INTEGER NOT NULL,
  open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL, close REAL NOT NULL, volume REAL NOT NULL,
  PRIMARY KEY (symbol, interval, start_ms)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS candle_coverage (
  symbol TEXT NOT NULL, interval TEXT NOT NULL, from_ms INTEGER NOT NULL, to_ms INTEGER NOT NULL,
  PRIMARY KEY (symbol, interval, from_ms)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS fills (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL, symbol TEXT NOT NULL, side TEXT NOT NULL,
  price REAL NOT NULL, quantity REAL NOT NULL, fee REAL NOT NULL, liquidity TEXT NOT NULL, at_ms INTEGER NOT NULL,
  market TEXT NOT NULL DEFAULT 'perp', closed_pnl REAL
);
CREATE INDEX IF NOT EXISTS fills_at ON fills (at_ms);
CREATE TABLE IF NOT EXISTS funding (
  symbol TEXT NOT NULL, at_ms INTEGER NOT NULL, amount REAL NOT NULL, rate REAL NOT NULL,
  PRIMARY KEY (symbol, at_ms)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS equity_snapshots (
  ts INTEGER PRIMARY KEY, equity REAL NOT NULL, open_pnl REAL NOT NULL, notional REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY, symbol TEXT NOT NULL, side TEXT NOT NULL, kind TEXT NOT NULL, price REAL,
  quantity REAL NOT NULL, executed REAL NOT NULL, status TEXT NOT NULL, created_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_created ON orders (created_ms);
CREATE TABLE IF NOT EXISTS transfers (
  id TEXT PRIMARY KEY, at_ms INTEGER NOT NULL, asset TEXT NOT NULL, flow TEXT NOT NULL,
  amount REAL, reason TEXT
);
CREATE INDEX IF NOT EXISTS transfers_at ON transfers (at_ms);
CREATE TABLE IF NOT EXISTS positions (
  id TEXT PRIMARY KEY, symbol TEXT NOT NULL, opened_ms INTEGER NOT NULL, closed_ms INTEGER,
  realized REAL NOT NULL, fees REAL NOT NULL, funding REAL NOT NULL
);
`;

const DAILY_PNL_SQL = `
WITH events AS (
  SELECT closed_ms AS at_ms, realized AS trading, 0.0 AS funding FROM positions WHERE closed_ms IS NOT NULL
  UNION ALL
  SELECT at_ms, closed_pnl, 0.0 FROM fills WHERE closed_pnl IS NOT NULL
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

function addFillColumns(db: DatabaseSync): void {
  const columns = (db.prepare("PRAGMA table_info(fills)").all() as Row[]).map((c) => c.name);
  if (columns.includes("market")) return;
  db.exec("ALTER TABLE fills ADD COLUMN market TEXT NOT NULL DEFAULT 'perp'");
  db.exec("ALTER TABLE fills ADD COLUMN closed_pnl REAL");
  db.exec("UPDATE fills SET market = 'spot' WHERE symbol NOT LIKE '%\\_PERP' ESCAPE '\\'");
}

type Row = Record<string, string | number | null>;

export type Store = ReturnType<typeof openStore>;

export function openStore(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA);
  addFillColumns(db);

  const upsertCandle = db.prepare(
    `INSERT INTO candles VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (symbol, interval, start_ms) DO UPDATE SET
       open = excluded.open, high = excluded.high, low = excluded.low, close = excluded.close, volume = excluded.volume`,
  );
  const upsertFill = db.prepare(
    `INSERT INTO fills VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       order_id = excluded.order_id, symbol = excluded.symbol, side = excluded.side, price = excluded.price,
       quantity = excluded.quantity, fee = excluded.fee, liquidity = excluded.liquidity, at_ms = excluded.at_ms,
       market = excluded.market, closed_pnl = excluded.closed_pnl`,
  );
  const upsertFunding = db.prepare(`INSERT OR REPLACE INTO funding VALUES (?, ?, ?, ?)`);
  const upsertTransfer = db.prepare(`INSERT OR REPLACE INTO transfers VALUES (?, ?, ?, ?, ?, ?)`);
  const upsertOrder = db.prepare(`INSERT OR REPLACE INTO orders VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
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
    market: r.market === "spot" ? "spot" : "perp",
    closedPnl: r.closed_pnl === null ? null : Usd.parse(r.closed_pnl),
    at: Millis.parse(r.at_ms),
  });

  return {
    saveCandles(symbol: MarketSymbol, interval: CandleInterval, candles: readonly Candle[]): void {
      inTransaction(() => {
        for (const c of candles) upsertCandle.run(symbol, interval, c.start, c.open, c.high, c.low, c.close, c.volume);
      });
    },
    candles(input: {
      symbol: MarketSymbol;
      interval: CandleInterval;
      since: Millis | null;
      before?: Millis | null;
      limit: number;
    }): Candle[] {
      const rows = (
        input.before != null
          ? db
              .prepare(
                `SELECT * FROM (SELECT * FROM candles WHERE symbol = ? AND interval = ? AND start_ms < ? ORDER BY start_ms DESC LIMIT ?) ORDER BY start_ms`,
              )
              .all(input.symbol, input.interval, input.before, input.limit)
          : input.since === null
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
    coverage(symbol: MarketSymbol, interval: CandleInterval): Range[] {
      const rows = db
        .prepare(`SELECT from_ms, to_ms FROM candle_coverage WHERE symbol = ? AND interval = ? ORDER BY from_ms`)
        .all(symbol, interval) as Row[];
      return rows.map((r) => ({ from: Number(r.from_ms), to: Number(r.to_ms) }));
    },
    addCoverage(symbol: MarketSymbol, interval: CandleInterval, range: Range): void {
      const merged = mergeRanges([...this.coverage(symbol, interval), range]);
      inTransaction(() => {
        db.prepare(`DELETE FROM candle_coverage WHERE symbol = ? AND interval = ?`).run(symbol, interval);
        const insert = db.prepare(`INSERT INTO candle_coverage VALUES (?, ?, ?, ?)`);
        for (const r of merged) insert.run(symbol, interval, r.from, r.to);
      });
    },
    mostTradedSymbol(): MarketSymbol | null {
      const row = db
        .prepare(`SELECT symbol FROM fills WHERE market = 'perp' GROUP BY symbol ORDER BY COUNT(*) DESC, symbol LIMIT 1`)
        .get() as Row | undefined;
      return row === undefined ? null : MarketSymbol.parse(row.symbol);
    },
    earliestFillAt(symbol: MarketSymbol): Millis | null {
      const row = db.prepare(`SELECT MIN(at_ms) AS m FROM fills WHERE symbol = ?`).get(symbol) as Row | undefined;
      return row?.m == null ? null : Millis.parse(row.m);
    },
    saveFills(fills: readonly Fill[]): void {
      inTransaction(() => {
        for (const f of fills)
          upsertFill.run(f.id, f.orderId, f.symbol, f.side, f.price, f.quantity, f.fee, f.liquidity, f.at, f.market, f.closedPnl);
      });
    },
    fills(limit: number, symbol: MarketSymbol | null = null): Fill[] {
      const rows =
        symbol === null
          ? db.prepare(`SELECT * FROM fills ORDER BY at_ms DESC, rowid DESC LIMIT ?`).all(limit)
          : db.prepare(`SELECT * FROM fills WHERE symbol = ? ORDER BY at_ms DESC, rowid DESC LIMIT ?`).all(symbol, limit);
      return (rows as Row[]).map(fillOf);
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
    saveTransfers(transfers: readonly Transfer[]): void {
      inTransaction(() => {
        for (const t of transfers)
          upsertTransfer.run(t.id, t.at, t.asset, t.flow, t.status === "counted" ? t.amount : null, t.status === "excluded" ? t.reason : null);
      });
    },
    allTransfers(): Transfer[] {
      return (db.prepare(`SELECT * FROM transfers ORDER BY at_ms, id`).all() as Row[]).map((r) =>
        Transfer.parse({
          id: r.id,
          at: r.at_ms,
          asset: r.asset,
          flow: r.flow,
          ...(r.amount === null ? { status: "excluded", reason: r.reason } : { status: "counted", amount: r.amount }),
        }),
      );
    },
    latestTransferAt(): Millis | null {
      const row = db.prepare(`SELECT MAX(at_ms) AS m FROM transfers`).get() as Row | undefined;
      return row?.m == null ? null : Millis.parse(row.m);
    },
    saveOrders(orders: readonly OrderRecord[]): void {
      inTransaction(() => {
        for (const o of orders)
          upsertOrder.run(o.id, o.symbol, o.side, o.kind, o.price, o.quantity, o.executedQuantity, o.status, o.createdAt);
      });
    },
    orders(): OrderRecord[] {
      const rows = db.prepare(`SELECT * FROM orders ORDER BY created_ms, id`).all() as Row[];
      return rows.map((r) => ({
        id: String(r.id),
        symbol: MarketSymbol.parse(r.symbol),
        side: r.side === "buy" ? "buy" : "sell",
        kind: r.kind === "limit" ? "limit" : r.kind === "trigger" ? "trigger" : "market",
        price: r.price === null ? null : Price.parse(r.price),
        quantity: Qty.parse(r.quantity),
        executedQuantity: Qty.parse(r.executed),
        status: OrderStatus.parse(r.status),
        createdAt: Millis.parse(r.created_ms),
      }));
    },
    knownOrderStatus(ids: readonly string[]): Map<string, string> {
      const known = new Map<string, string>();
      const stmt = db.prepare(`SELECT status FROM orders WHERE id = ?`);
      for (const id of ids) {
        const row = stmt.get(id) as Row | undefined;
        if (row !== undefined) known.set(id, String(row.status));
      }
      return known;
    },
    fillRange(): { first: Millis; last: Millis } | null {
      const row = db.prepare(`SELECT MIN(at_ms) a, MAX(at_ms) b FROM fills`).get() as Row | undefined;
      return row?.a == null || row?.b == null ? null : { first: Millis.parse(row.a), last: Millis.parse(row.b) };
    },
    allFills(): Fill[] {
      return (db.prepare(`SELECT * FROM fills ORDER BY at_ms, rowid`).all() as Row[]).map(fillOf);
    },
    allFunding(): { symbol: MarketSymbol; at: Millis; amount: Usd }[] {
      return (db.prepare(`SELECT symbol, at_ms, amount FROM funding ORDER BY at_ms`).all() as Row[]).map((r) => ({
        symbol: MarketSymbol.parse(r.symbol),
        at: Millis.parse(r.at_ms),
        amount: Usd.parse(r.amount),
      }));
    },
    lastFillByOrder(): Map<string, number> {
      const rows = db.prepare(`SELECT order_id, MAX(at_ms) m FROM fills GROUP BY order_id`).all() as Row[];
      return new Map(rows.map((r) => [String(r.order_id), Number(r.m)]));
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
