import { afterEach, describe, expect, it, vi } from "vitest";
import { Fill, MarketSymbol, Millis, Price, Qty, Usd, type AccountInfo, type Exchange, type AccountSnapshot, type Surface } from "@hy/types";
import { decodePayload } from "@hy/replay";
import { createAccountContext, planFor, startAccount, type AccountContext } from "./accounts.js";
import { createApp } from "./app.js";
import type { AccountConfig } from "./config.js";
import { openStore } from "./db.js";
import type { ExchangeCapabilities, ExchangeReader } from "./exchange.js";

const NOW = Date.now();
const CLIENT = { incoming: { socket: { remoteAddress: "10.0.0.1" } } };
const sym = (s: string) => MarketSymbol.parse(s);

const fill = (id: string, symbol: MarketSymbol, at: number): Fill => ({
  id, orderId: `o${id}`, symbol, side: "buy", price: Price.parse(100), quantity: Qty.parse(1), fee: Usd.parse(0.1), liquidity: "maker", at: Millis.parse(at), market: "perp", closedPnl: null,
});
const snapshot = (equity: number): AccountSnapshot => ({
  exchange: "backpack", asOf: Millis.parse(NOW),
  account: { equity: Usd.parse(equity), availableEquity: Usd.parse(0), lockedEquity: Usd.parse(0), initialMarginFraction: 0, maintenanceMarginFraction: 0, marginFraction: null, leverageLimit: 50, liquidating: false },
  positions: [], openOrders: [], metrics: { grossNotional: Usd.parse(0), netNotional: Usd.parse(0), leverage: 0, openPnl: Usd.parse(0) },
});

const CAPABILITIES: ExchangeCapabilities = {
  intervals: ["15m", "1h", "4h"],
  history: { candleDepthBars: null, fillDepth: null },
  minLivePollMs: 0,
  minSyncMs: 0,
  minCandleRefreshMs: 0,
};

function fakeReader(input: { exchange: Exchange; chartSymbol: string; equity: number; fillIds: string[] }) {
  const calls: string[] = [];
  const chartSymbol = sym(input.chartSymbol);
  const reader: ExchangeReader = {
    exchange: input.exchange,
    chartSymbol,
    capabilities: CAPABILITIES,
    fetchLive: async () => (calls.push("live"), snapshot(input.equity)),
    fetchFills: async () => (calls.push("fills"), input.fillIds.map((id, i) => fill(id, chartSymbol, NOW - (100 - i) * 1000))),
    fetchFunding: async () => (calls.push("funding"), []),
    fetchPositionHistory: async () => (calls.push("positions"), []),
    orderHistory: async function* () {
      calls.push("orders");
      yield [];
    },
    fetchCandles: async () => (calls.push("candles"), []),
  };
  return { reader, calls };
}

const config = (id: string, surfaces: Surface[]): AccountConfig => ({
  id, label: id.toUpperCase(), surfaces, dbPath: ":memory:",
  credentials: { exchange: "backpack", apiUrl: "http://unused.invalid", apiKey: "unused", apiSecret: "unused" },
});

const running: AccountContext[] = [];
afterEach(() => {
  for (const c of running.splice(0)) c.feed.stop();
});

async function boot(accounts: { config: AccountConfig; reader: ReturnType<typeof fakeReader> }[]) {
  const readers = new Map(accounts.map((a) => [a.config.id, a.reader.reader]));
  const contexts = accounts.map((a) =>
    createAccountContext(a.config, {
      readerFor: (c) => readers.get(c.id) as ExchangeReader,
      storeFor: () => openStore(":memory:"),
      log: () => undefined,
    }),
  );
  running.push(...contexts);
  for (const c of contexts) startAccount(c, () => undefined);
  await vi.waitFor(() => {
    for (const c of contexts) expect(c.feed.current().kind).toBe("live");
    for (const c of contexts) expect(c.store.fills(10, null).length).toBeGreaterThan(0);
  });
  const app = createApp({ registry: contexts, webRoot: null });
  return (path: string) => app.request(path, {}, CLIENT);
}

describe("per-account routing", () => {
  const live = () => ({ config: config("live", ["dashboard"]), reader: fakeReader({ exchange: "backpack", chartSymbol: "BTC_USDC_PERP", equity: 1002, fillIds: ["L1", "L2"] }) });
  const hl = () => ({ config: config("hl", ["dashboard", "replay"]), reader: fakeReader({ exchange: "hyperliquid", chartSymbol: "BTC-PERP", equity: 30, fillIds: ["H1", "H2", "H3"] }) });
  const test = () => ({ config: config("test", ["replay"]), reader: fakeReader({ exchange: "backpack", chartSymbol: "BTC_USDC_PERP", equity: 7, fillIds: ["T1"] }) });

  it("lists accounts with the chart market owned by each adapter", async () => {
    const get = await boot([live(), hl()]);
    const list = (await (await get("/api/accounts")).json()) as AccountInfo[];
    expect(list.map((a) => [a.id, a.exchange, a.chartSymbol, a.surfaces])).toEqual([
      ["live", "backpack", "BTC_USDC_PERP", ["dashboard"]],
      ["hl", "hyperliquid", "BTC-PERP", ["dashboard", "replay"]],
    ]);
  });

  it("serves each dashboard route from the addressed account only", async () => {
    const get = await boot([live(), hl()]);
    expect((await (await get("/api/accounts/live/snapshot")).json()).snapshot.account.equity).toBe(1002);
    expect((await (await get("/api/accounts/hl/snapshot")).json()).snapshot.account.equity).toBe(30);
    const ids = async (id: string) => ((await (await get(`/api/accounts/${id}/fills?limit=10`)).json()) as { id: string }[]).map((f) => f.id).sort();
    expect(await ids("live")).toEqual(["L1", "L2"]);
    expect(await ids("hl")).toEqual(["H1", "H2", "H3"]);
    expect((await get("/api/accounts/hl/daily-pnl")).status).toBe(200);
    expect((await get("/api/accounts/hl/equity?range=1d")).status).toBe(200);
  });

  it("never runs another account's adapter for a request", async () => {
    const a = live();
    const b = hl();
    const get = await boot([a, b]);
    await vi.waitFor(() => expect(b.reader.calls).toContain("fills"));
    const before = [...b.reader.calls];
    await get("/api/accounts/live/fills");
    await get("/api/accounts/live/snapshot");
    expect(b.reader.calls).toEqual(before);
  });

  it("serves /api/replay from the addressed replay account and refreshes only its candles", async () => {
    const t = test();
    const get = await boot([live(), hl(), t]);
    const res = await get("/api/replay?account=test&interval=1h");
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.anchor.equity).toBe(7);
    expect(payload.symbol).toBe("BTC_USDC_PERP");
    expect(decodePayload(payload).fills.map((f) => f.id)).toEqual(["T1"]);
    expect(t.reader.calls).toContain("candles");
    const other = await (await get("/api/replay?account=hl&interval=1h")).json();
    expect(other.symbol).toBe("BTC-PERP");
    expect(decodePayload(other).fills.map((f) => f.id).sort()).toEqual(["H1", "H2", "H3"]);
  });

  it("defaults /api/replay to the first replay account", async () => {
    const get = await boot([live(), hl(), test()]);
    expect((await (await get("/api/replay")).json()).anchor.equity).toBe(30);
  });

  it("answers 404 for unknown ids and for a missing surface", async () => {
    const get = await boot([live(), test()]);
    for (const path of [
      "/api/accounts/nope/snapshot",
      "/api/accounts/test/snapshot",
      "/api/accounts/test/stream",
      "/api/accounts/test/fills",
      "/api/accounts/test/candles?interval=1h",
      "/api/accounts/test/equity",
      "/api/accounts/test/daily-pnl",
      "/api/replay?account=live",
      "/api/replay?account=nope",
    ]) {
      expect([path, (await get(path)).status]).toEqual([path, 404]);
    }
    expect((await get("/api/accounts/live/snapshot")).status).toBe(200);
  });

  it("answers 404 on /api/replay when no account has the replay surface", async () => {
    const get = await boot([live()]);
    expect((await get("/api/replay")).status).toBe(404);
  });
});

const PACING = { minLivePollMs: 0, minSyncMs: 0 };

describe("planFor", () => {
  it("polls a replay-only account slowly and skips dashboard-only work", () => {
    const p = planFor(["replay"], PACING);
    expect(p.pollMs).toBeGreaterThanOrEqual(30_000);
    expect(p.recordEquity).toBe(false);
    expect(p.jobs.map((j) => j.name)).toEqual(["fill sync", "funding sync", "order sync"]);
  });

  it("polls a dashboard account fast, records equity and skips order history", () => {
    const p = planFor(["dashboard"], PACING);
    expect(p.pollMs).toBe(2_000);
    expect(p.recordEquity).toBe(true);
    expect(p.jobs.map((j) => j.name)).toEqual(["fill sync", "funding sync", "position sync"]);
  });

  it("unions the jobs of both surfaces without repeats", () => {
    expect(planFor(["dashboard", "replay"], PACING).jobs.map((j) => j.name)).toEqual(["fill sync", "funding sync", "position sync", "order sync"]);
  });
});
