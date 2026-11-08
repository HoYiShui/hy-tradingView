import { describe, expect, it } from "vitest";
import { Fill, MarketSymbol, Millis, Price, Qty, Usd } from "@hy/types";
import { createAccountContext } from "./accounts.js";
import { createChartGuard, resolveChartSymbol } from "./chart.js";
import type { AccountConfig } from "./config.js";
import { openStore } from "./db.js";
import type { ExchangeReader } from "./exchange.js";

const sym = (s: string) => MarketSymbol.parse(s);
const BTC = sym("BTC_USDC_PERP");
const SOL = sym("SOL_USDC_PERP");
let n = 0;
const fill = (symbol: string, market: "perp" | "spot" = "perp"): Fill => ({
  id: String(++n), orderId: "o", symbol: sym(symbol), side: "buy", price: Price.parse(1), quantity: Qty.parse(1), fee: Usd.parse(0), liquidity: "maker", at: Millis.parse(1000 + n), market, closedPnl: null,
});

describe("resolveChartSymbol", () => {
  const store = (symbols: string[], spot: string[] = []) => {
    const s = openStore(":memory:");
    s.saveFills([...symbols.map((x) => fill(x)), ...spot.map((x) => fill(x, "spot"))]);
    return s;
  };

  it("keeps the adapter's market by default and the configured market when named", () => {
    const s = store(["ETH_USDC_PERP"]);
    expect(resolveChartSymbol({ choice: { kind: "default" }, store: s, fallback: BTC })).toBe(BTC);
    expect(resolveChartSymbol({ choice: { kind: "market", symbol: SOL }, store: s, fallback: BTC })).toBe(SOL);
  });

  it("picks the perp market with the most stored fills", () => {
    const s = store(["BTC_USDC_PERP", "SOL_USDC_PERP", "SOL_USDC_PERP", "SOL_USDC_PERP", "ETH_USDC_PERP", "ETH_USDC_PERP"]);
    expect(resolveChartSymbol({ choice: { kind: "most-traded" }, store: s, fallback: BTC })).toBe(SOL);
  });

  it("ignores spot fills when counting", () => {
    const s = store(["BTC_USDC_PERP"], ["ETH_USDC", "ETH_USDC", "ETH_USDC"]);
    expect(resolveChartSymbol({ choice: { kind: "most-traded" }, store: s, fallback: SOL })).toBe(BTC);
  });

  it("breaks a tie by symbol so the choice is stable across restarts", () => {
    const s = store(["SOL_USDC_PERP", "BTC_USDC_PERP"]);
    expect(resolveChartSymbol({ choice: { kind: "most-traded" }, store: s, fallback: SOL })).toBe(BTC);
  });

  it("falls back to the adapter's market when there are no fills", () => {
    expect(resolveChartSymbol({ choice: { kind: "most-traded" }, store: openStore(":memory:"), fallback: BTC })).toBe(BTC);
  });
});

describe("chart guard", () => {
  const reader = (exists: (s: string) => Promise<boolean>) => {
    const calls: string[] = [];
    return { calls, reader: { exchange: "backpack" as const, marketExists: async (s: MarketSymbol) => (calls.push(s), exists(s)) } };
  };
  const logs: string[] = [];
  const log = (m: string) => void logs.push(m);

  it("passes a market that exists and asks the exchange once", async () => {
    const r = reader(async () => true);
    const guard = createChartGuard({ reader: r.reader, symbol: SOL, log });
    expect(await Promise.all([guard.check(), guard.check()])).toEqual([null, null]);
    expect(await guard.check()).toBeNull();
    expect(r.calls).toEqual([SOL]);
  });

  it("names the market and the exchange when it does not exist", async () => {
    const guard = createChartGuard({ reader: reader(async () => false).reader, symbol: sym("NOPE_USDC_PERP"), log });
    const message = await guard.check();
    expect(message).toContain("NOPE_USDC_PERP");
    expect(message).toContain("backpack");
    expect(await guard.check()).toBe(message);
  });

  it("does not condemn a market on a network error and asks again next time", async () => {
    let up = false;
    const r = reader(async () => {
      if (!up) throw new Error("socket closed");
      return false;
    });
    const guard = createChartGuard({ reader: r.reader, symbol: SOL, log });
    expect(await guard.check()).toBeNull();
    up = true;
    expect(await guard.check()).toContain("does not exist");
    expect(r.calls).toHaveLength(2);
  });
});

describe("account context", () => {
  const config = (chart: AccountConfig["chart"]): AccountConfig => ({
    id: "a", label: "A", surfaces: ["replay"], dbPath: ":memory:", chart,
    credentials: { exchange: "backpack", apiUrl: "http://unused.invalid", apiKey: "k", apiSecret: "s" },
  });
  const make = (chart: AccountConfig["chart"], symbols: string[]) => {
    const store = openStore(":memory:");
    store.saveFills(symbols.map((s) => fill(s)));
    const reader = { exchange: "backpack", defaultChartSymbol: BTC, capabilities: { intervals: ["1h"], history: { candleDepthBars: null, fillDepth: null }, minLivePollMs: 0, minSyncMs: 0, minCandleRefreshMs: 0 }, marketExists: async () => true } as unknown as ExchangeReader;
    return createAccountContext(config(chart), { readerFor: () => reader, storeFor: () => store, log: () => undefined });
  };

  it("exposes the resolved chart market through the account info", () => {
    expect(make({ kind: "default" }, ["SOL_USDC_PERP"]).info.chartSymbol).toBe(BTC);
    expect(make({ kind: "most-traded" }, ["SOL_USDC_PERP"]).info.chartSymbol).toBe(SOL);
    expect(make({ kind: "market", symbol: sym("ETH_USDC_PERP") }, []).info.chartSymbol).toBe("ETH_USDC_PERP");
  });
});
