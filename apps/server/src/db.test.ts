import { afterEach, describe, expect, it } from "vitest";
import { MarketSymbol, Millis, Usd } from "@hy/types";
import { downsampleStep, EQUITY_BUCKET_MS, EQUITY_MAX_POINTS, equityBucket, openStore, type Store } from "./db.js";

const symbol = MarketSymbol.parse("BTC_USDC_PERP");
const at = (iso: string) => Millis.parse(Date.parse(iso));
const funding = (iso: string, amount: number) => ({ symbol, at: at(iso), amount: Usd.parse(amount), rate: 0.0000125 });
const position = (id: string, closed: string | null, realized: number) => ({
  id,
  symbol,
  openedAt: at("2026-01-01T00:00:00Z"),
  closedAt: closed === null ? null : at(closed),
  realizedPnl: Usd.parse(realized),
  fees: Usd.parse(0),
  funding: Usd.parse(0),
});

let store: Store;
afterEach(() => store.close());

describe("dailyPnl", () => {
  it("is empty for an empty database", () => {
    store = openStore(":memory:");
    expect(store.dailyPnl()).toEqual([]);
  });

  it("buckets closed positions and funding by UTC day with a running cumulative", () => {
    store = openStore(":memory:");
    store.saveFunding([
      funding("2026-03-01T01:00:00Z", -1),
      funding("2026-03-01T23:59:59Z", -2),
      funding("2026-03-02T00:00:00Z", -0.5),
    ]);
    store.savePositions([
      position("a", "2026-03-01T12:00:00Z", 10),
      position("b", "2026-03-03T08:00:00Z", -4),
      position("open", null, 99),
    ]);
    expect(store.dailyPnl()).toEqual([
      { day: "2026-03-01", trading: 10, funding: -3, total: 7, cumulative: 7 },
      { day: "2026-03-02", trading: 0, funding: -0.5, total: -0.5, cumulative: 6.5 },
      { day: "2026-03-03", trading: -4, funding: 0, total: -4, cumulative: 2.5 },
    ]);
  });

  it("does not double count when the same records are saved again", () => {
    store = openStore(":memory:");
    const payments = [funding("2026-03-01T01:00:00Z", -1)];
    store.saveFunding(payments);
    store.saveFunding(payments);
    expect(store.dailyPnl()).toHaveLength(1);
    expect(store.dailyPnl()[0]?.funding).toBe(-1);
  });
});

describe("candles", () => {
  const candle = (start: number, close: number) => ({
    start: Millis.parse(start),
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
  });

  it("replaces a candle with the same key so the live bar updates in place", () => {
    store = openStore(":memory:");
    store.saveCandles(symbol, "1h", [candle(1000, 1) as never, candle(2000, 2) as never]);
    store.saveCandles(symbol, "1h", [candle(2000, 5) as never]);
    expect(store.candles({ symbol, interval: "1h", since: null, limit: 10 }).map((c) => c.close)).toEqual([1, 5]);
    expect(store.latestCandleStart(symbol, "1h")).toBe(2000);
  });

  it("returns the newest N candles in ascending order and keeps intervals apart", () => {
    store = openStore(":memory:");
    store.saveCandles(symbol, "1h", [1, 2, 3, 4].map((n) => candle(n * 1000, n) as never));
    store.saveCandles(symbol, "1d", [candle(9000, 9) as never]);
    expect(store.candles({ symbol, interval: "1h", since: null, limit: 2 }).map((c) => c.start)).toEqual([3000, 4000]);
    expect(store.candles({ symbol, interval: "1h", since: Millis.parse(2000), limit: 10 })).toHaveLength(3);
  });
});

describe("candle cursor and coverage", () => {
  const c = (n: number) => ({ start: Millis.parse(n * 1000), open: 1, high: 1, low: 1, close: 1, volume: 1 }) as never;

  it("returns the newest N bars strictly before the cursor in ascending order", () => {
    store = openStore(":memory:");
    store.saveCandles(symbol, "1h", [1, 2, 3, 4, 5].map(c));
    const page = store.candles({ symbol, interval: "1h", since: null, before: Millis.parse(4000), limit: 2 });
    expect(page.map((x) => x.start)).toEqual([2000, 3000]);
    expect(store.candles({ symbol, interval: "1h", since: null, before: Millis.parse(1000), limit: 5 })).toEqual([]);
  });

  it("merges stored coverage ranges per interval", () => {
    store = openStore(":memory:");
    store.addCoverage(symbol, "1h", { from: 0, to: 10 });
    store.addCoverage(symbol, "1h", { from: 10, to: 20 });
    store.addCoverage(symbol, "1h", { from: 30, to: 40 });
    store.addCoverage(symbol, "4h", { from: 5, to: 6 });
    expect(store.coverage(symbol, "1h")).toEqual([{ from: 0, to: 20 }, { from: 30, to: 40 }]);
    expect(store.coverage(symbol, "4h")).toEqual([{ from: 5, to: 6 }]);
  });
});

describe("fills", () => {
  it("returns newest first and tracks the latest fill time for incremental sync", () => {
    store = openStore(":memory:");
    const fill = (id: string, ms: number) => ({
      id,
      orderId: "o",
      symbol,
      side: "buy" as const,
      price: 1 as never,
      quantity: 1 as never,
      fee: 0 as never,
      liquidity: "maker" as const,
      at: Millis.parse(ms),
    });
    expect(store.latestFillAt()).toBeNull();
    store.saveFills([fill("1", 1000), fill("2", 3000), fill("3", 2000)]);
    expect(store.fills(10).map((f) => f.id)).toEqual(["2", "3", "1"]);
    expect(store.latestFillAt()).toBe(3000);
  });
});

describe("equity snapshots", () => {
  const point = (ts: number, equity: number) => ({ ts: Millis.parse(ts), equity: Usd.parse(equity), openPnl: Usd.parse(0), notional: Usd.parse(0) });
  const NOW = Date.parse("2026-06-10T12:00:00Z");

  it("keeps one point per five minute bucket so a restart does not duplicate it", () => {
    store = openStore(":memory:");
    const t = Date.parse("2026-06-10T11:00:00Z");
    store.saveEquity(point(t + 1000, 100));
    store.saveEquity(point(t + 200_000, 101));
    store.saveEquity(point(t + EQUITY_BUCKET_MS, 102));
    const all = store.equity("all", NOW);
    expect(all.map((p) => p.equity)).toEqual([101, 102]);
    expect(all[0]?.ts).toBe(equityBucket(t));
  });

  it("returns a single point for a brand new database and nothing for an empty one", () => {
    store = openStore(":memory:");
    expect(store.equity("7d", NOW)).toEqual([]);
    store.saveEquity(point(NOW - 1000, 50));
    expect(store.equity("7d", NOW)).toHaveLength(1);
  });

  it("filters by range", () => {
    store = openStore(":memory:");
    store.saveEquity(point(NOW - 3 * 86_400_000, 1));
    store.saveEquity(point(NOW - 3_600_000, 2));
    expect(store.equity("1d", NOW).map((p) => p.equity)).toEqual([2]);
    expect(store.equity("7d", NOW).map((p) => p.equity)).toEqual([1, 2]);
  });

  it("downsamples a long history to a bounded number of points keeping the last point of each bucket", () => {
    store = openStore(":memory:");
    const days = 20;
    const n = (days * 86_400_000) / EQUITY_BUCKET_MS;
    for (let i = 0; i < n; i++) store.saveEquity(point(NOW - (n - i) * EQUITY_BUCKET_MS, i));
    const out = store.equity("all", NOW);
    expect(out.length).toBeLessThanOrEqual(EQUITY_MAX_POINTS + 1);
    expect(out.length).toBeGreaterThan(EQUITY_MAX_POINTS / 2);
    expect(out.at(-1)?.equity).toBe(n - 1);
    expect(out.map((p) => p.ts)).toEqual([...out.map((p) => p.ts)].sort((a, b) => a - b));
  });

  it("never uses a step finer than the recording bucket", () => {
    store = openStore(":memory:");
    expect(downsampleStep(0)).toBe(EQUITY_BUCKET_MS);
    expect(downsampleStep(3_600_000)).toBe(EQUITY_BUCKET_MS);
  });
});
