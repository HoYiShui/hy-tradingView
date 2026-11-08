import { describe, expect, it } from "vitest";
import candles from "../../../../scripts/samples-hyperliquid/candle-1h.json";
import clearinghouse from "../../../../scripts/samples-hyperliquid/clearinghouseState.json";
import historicalOrders from "../../../../scripts/samples-hyperliquid/historicalOrders.json";
import perpDexs from "../../../../scripts/samples-hyperliquid/perpDexs.json";
import spotState from "../../../../scripts/samples-hyperliquid/spotClearinghouseState.json";
import userFills from "../../../../scripts/samples-hyperliquid/userFills.json";
import variants from "../../../../scripts/samples-hyperliquid/variants.json";
import { MarketSymbol, Millis } from "@hy/types";
import { Address } from "./address.js";
import { createHyperliquidReader, HYPERLIQUID_CAPABILITIES } from "./adapter.js";
import type { HyperliquidClient, InfoRequest } from "./client.js";

const ADDRESS = Address.parse("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed");

function fakeClient(over: Partial<Record<InfoRequest["type"], (r: InfoRequest) => unknown>> = {}) {
  const calls: InfoRequest[] = [];
  const answers: Record<string, (r: InfoRequest) => unknown> = {
    userAbstraction: () => "unifiedAccount",
    spotClearinghouseState: () => spotState,
    perpDexs: () => perpDexs,
    clearinghouseState: () => clearinghouse,
    frontendOpenOrders: () => [],
    ...over,
  };
  const client: HyperliquidClient = {
    async info(request) {
      calls.push(request);
      const answer = answers[request.type];
      if (answer === undefined) throw new Error(`unexpected ${request.type}`);
      return answer(request);
    },
  };
  return { client, calls };
}

const reader = (client: HyperliquidClient, clock = { t: 1_000_000 }) =>
  createHyperliquidReader({ client, address: ADDRESS, now: () => clock.t, pauseMs: 0 });

describe("hyperliquid reader", () => {
  it("charts BTC and declares the exchange history limits", () => {
    const r = reader(fakeClient().client);
    expect(r.exchange).toBe("hyperliquid");
    expect(r.defaultChartSymbol).toBe("BTC");
    expect(HYPERLIQUID_CAPABILITIES.history).toEqual({ candleDepthBars: 5000, fillDepth: 10_000 });
    expect(HYPERLIQUID_CAPABILITIES.intervals).toContain("15m");
  });

  it("serves equity from the spot pool of a unified account", async () => {
    const snapshot = await reader(fakeClient().client).fetchLive();
    expect(snapshot.account.equity).toBeCloseTo(133.384927, 6);
    expect(snapshot.positions).toEqual([]);
  });

  it("scans every builder dex once, then reads only dexs with activity until the next scan", async () => {
    const clock = { t: 1_000_000 };
    const xyz = { ...clearinghouse, assetPositions: variants.iso.assetPositions };
    const { client, calls } = fakeClient({
      clearinghouseState: (r) => (r.type === "clearinghouseState" && r.dex === "xyz" ? xyz : clearinghouse),
    });
    const r = reader(client, clock);
    const first = await r.fetchLive();
    const dexReads = () => new Set(calls.filter((c) => c.type === "clearinghouseState").map((c) => (c.type === "clearinghouseState" ? (c.dex ?? "") : "")));
    expect(dexReads().size).toBeGreaterThan(2);
    expect(first.positions.length).toBeGreaterThan(0);
    calls.length = 0;
    clock.t += 60_000;
    await r.fetchLive();
    expect([...dexReads()].sort()).toEqual(["", "xyz"]);
    expect(calls.some((c) => c.type === "perpDexs")).toBe(false);
  });

  it("pages fills by time without repeating the boundary fill", async () => {
    const chronological = [...userFills].reverse();
    const server = (r: InfoRequest) => {
      if (r.type !== "userFillsByTime") throw new Error("unexpected");
      const out = chronological.filter((f) => f.time >= r.startTime);
      return out.slice(0, 500);
    };
    const { client, calls } = fakeClient({ userFillsByTime: server });
    const fills = await reader(client).fetchFills({ from: null });
    expect(fills).toHaveLength(userFills.length);
    expect(new Set(fills.map((f) => f.id)).size).toBe(fills.length);
    expect(calls.filter((c) => c.type === "userFillsByTime").length).toBeGreaterThan(1);
  });

  it("fetches only from the last stored fill on an incremental sync", async () => {
    const { client, calls } = fakeClient({ userFillsByTime: () => [] });
    await reader(client).fetchFills({ from: Millis.parse(1234) });
    expect(calls).toEqual([{ type: "userFillsByTime", user: ADDRESS, startTime: 1234 }]);
  });

  it("pages the ledger by time, keeps each update once and starts from the last stored transfer", async () => {
    const hash = `0x${"0".repeat(64)}`;
    const ledger = Array.from({ length: 600 }, (_, i) => ({ time: i + 1, hash, delta: { type: "deposit", usdc: "1.0" } }));
    const { client, calls } = fakeClient({
      userNonFundingLedgerUpdates: (r) => (r.type === "userNonFundingLedgerUpdates" ? ledger.filter((u) => u.time >= r.startTime).slice(0, 500) : []),
    });
    const all = await reader(client).fetchTransfers({ from: null });
    expect(all).toHaveLength(600);
    expect(new Set(all.map((t) => t.id)).size).toBe(600);
    expect(calls.map((c) => (c.type === "userNonFundingLedgerUpdates" ? c.startTime : -1))).toEqual([0, 500]);
    calls.length = 0;
    await reader(client).fetchTransfers({ from: Millis.parse(590) });
    expect(calls).toEqual([{ type: "userNonFundingLedgerUpdates", user: ADDRESS, startTime: 590 }]);
  });

  it("checks a chart coin against the listed perps of its own dex and ignores delisted ones", async () => {
    const meta = (r: InfoRequest) =>
      r.type === "meta" && r.dex === "xyz"
        ? { universe: [{ name: "xyz:GOLD" }] }
        : { universe: [{ name: "BTC" }, { name: "SOL" }, { name: "OLD", isDelisted: true }] };
    const { client, calls } = fakeClient({ meta });
    const r = reader(client);
    const exists = (s: string) => r.marketExists(MarketSymbol.parse(s));
    expect([await exists("SOL"), await exists("OLD"), await exists("NOPE"), await exists("xyz:GOLD"), await exists("xyz:NOPE")]).toEqual([true, false, false, true, false]);
    expect(calls.filter((c) => c.type === "meta" && c.dex === "xyz")).toHaveLength(2);
  });

  it("returns candles oldest first", async () => {
    const shuffled = [...candles].reverse();
    const { client } = fakeClient({ candleSnapshot: () => shuffled });
    const out = await reader(client).fetchCandles({ symbol: reader(client).defaultChartSymbol, interval: "1h", from: Millis.parse(0), to: Millis.parse(1) });
    expect(out.map((c) => c.start)).toEqual([...out.map((c) => c.start)].sort((a, b) => a - b));
  });

  it("yields order history as one page", async () => {
    const { client } = fakeClient({ historicalOrders: () => historicalOrders });
    const pages: unknown[][] = [];
    for await (const page of reader(client).orderHistory()) pages.push(page);
    expect(pages).toHaveLength(1);
    expect(pages[0]?.length).toBeGreaterThan(0);
  });
});
