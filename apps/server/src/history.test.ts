import { describe, expect, it } from "vitest";
import { INTERVAL_MS, MarketSymbol, Millis } from "@hy/types";
import { openStore } from "./db.js";
import type { ExchangeReader } from "./exchange.js";
import { backfillStart, createCandleService, syncTransfers } from "./history.js";

const symbol = MarketSymbol.parse("BTC_USDC_PERP");
const H = INTERVAL_MS["1h"];
const NOW = 100_000 * H + 1234;
const latest = { since: null, before: null, limit: 500 };

function fakeReader(candleDepthBars: number | null = null) {
  const calls: { from: number; to: number }[] = [];
  const reader = {
    capabilities: { minCandleRefreshMs: 2000, history: { candleDepthBars, fillDepth: null } },
    async fetchCandles({ from, to }: { from: number; to: number }) {
      calls.push({ from, to });
      await new Promise((r) => setTimeout(r, 2));
      const out = [];
      for (let t = Math.ceil(from / H) * H; t <= to; t += H) out.push({ start: Millis.parse(t), open: 1, high: 1, low: 1, close: 1, volume: 1 });
      return out as never;
    },
  } as unknown as ExchangeReader;
  return { reader, calls };
}

const idle = (ms = 80) => new Promise((r) => setTimeout(r, ms));

describe("candle service", () => {
  it("serves many concurrent browsers with one tail request and one backfill pass", async () => {
    const { reader, calls } = fakeReader();
    const store = openStore(":memory:");
    const service = createCandleService({ reader, store, symbol, now: () => NOW, pauseMs: 0 });
    await Promise.all(Array.from({ length: 50 }, () => service.get("1h", latest)));
    await idle();
    const first = calls.length;
    await service.get("1h", latest);
    await idle();
    expect(calls.length).toBe(first);
    expect(first).toBeLessThanOrEqual(3);
    store.close();
  });

  it("backfills from the earliest fill and a rerun fetches nothing already covered", async () => {
    const { reader, calls } = fakeReader();
    const store = openStore(":memory:");
    const fillAt = NOW - 2500 * H;
    store.saveFills([{ id: "1", orderId: "o", symbol, side: "buy", price: 1 as never, quantity: 1 as never, fee: 0 as never, liquidity: "maker", at: Millis.parse(fillAt), market: "perp", closedPnl: null }]);
    const service = createCandleService({ reader, store, symbol, now: () => NOW, pauseMs: 0 });
    await service.get("1h", latest);
    await idle(300);
    const oldest = store.candles({ symbol, interval: "1h", since: null, before: Millis.parse(NOW), limit: 10_000 })[0];
    expect(oldest?.start).toBeLessThanOrEqual(fillAt);
    for (const c of calls) expect(c.to - c.from).toBeLessThanOrEqual(1000 * H);
    const before = calls.length;
    const second = createCandleService({ reader, store, symbol, now: () => NOW + 5000, pauseMs: 0 });
    await second.get("1h", latest);
    await idle(100);
    expect(calls.length - before).toBe(1);
    store.close();
  });

  it("pages older bars with a before cursor", async () => {
    const { reader } = fakeReader();
    const store = openStore(":memory:");
    const service = createCandleService({ reader, store, symbol, now: () => NOW, pauseMs: 0 });
    const page1 = await service.get("1h", latest);
    const cursor = page1[0]?.start;
    expect(cursor).toBeDefined();
    const page2 = await service.get("1h", { since: null, before: Millis.parse(cursor ?? 0), limit: 100 });
    expect(page2.length).toBe(100);
    expect(page2.at(-1)?.start).toBeLessThan(cursor ?? 0);
    expect(page2.at(-1)?.start).toBe((cursor ?? 0) - H);
    store.close();
  });
});

describe("candle history depth limit", () => {
  it("stops at the exchange boundary, marks it covered and never refetches", async () => {
    const { reader, calls } = fakeReader(1500);
    const store = openStore(":memory:");
    store.saveFills([{ id: "1", orderId: "o", symbol, side: "buy", price: 1 as never, quantity: 1 as never, fee: 0 as never, liquidity: "maker", at: Millis.parse(NOW - 4000 * H), market: "perp", closedPnl: null }]);
    const service = createCandleService({ reader, store, symbol, now: () => NOW, pauseMs: 0 });
    await service.get("1h", latest);
    await idle(300);
    const oldest = store.candles({ symbol, interval: "1h", since: null, before: Millis.parse(NOW), limit: 10_000 })[0];
    expect(oldest?.start).toBeGreaterThanOrEqual(NOW - 1500 * H - H);
    const before = calls.length;
    const second = createCandleService({ reader, store, symbol, now: () => NOW + 5000, pauseMs: 0 });
    await second.get("1h", latest);
    await idle(300);
    expect(calls.length - before).toBe(1);
    store.close();
  });
});

describe("backfillStart", () => {
  it("never reaches past the exchange depth", () => {
    expect(backfillStart({ now: NOW, step: H, earliestFill: NOW - 9000 * H, depthBars: 5000 })).toBe(NOW - 5000 * H);
  });

  it("starts one bar before the earliest fill, bounded by the bar cap and never later than the tail window", () => {
    const step = H;
    expect(backfillStart({ now: NOW, step, earliestFill: NOW - 3000 * H, depthBars: null })).toBeLessThan(NOW - 3000 * H + 1);
    expect(backfillStart({ now: NOW, step, earliestFill: NOW - 10 * H, depthBars: null })).toBe(NOW - 1000 * H);
    expect(backfillStart({ now: NOW, step, earliestFill: null, depthBars: null })).toBe(NOW - 1000 * H);
    expect(backfillStart({ now: NOW, step, earliestFill: NOW - 1e9 * H, depthBars: null })).toBe(NOW - 60_000 * H);
  });
});

describe("transfer sync", () => {
  const deposit = (id: string, at: number) => ({ id, at: Millis.parse(at), asset: "USDC", flow: "deposit", status: "counted", amount: 10 }) as never;

  it("reads everything first, then only from a recheck window before the latest stored transfer, and never duplicates", async () => {
    const froms: (number | null)[] = [];
    const day = 86_400_000;
    const reader = {
      async fetchTransfers({ from }: { from: number | null }) {
        froms.push(from);
        return [deposit("a", 10 * day), deposit("b", 20 * day)];
      },
    } as unknown as ExchangeReader;
    const store = openStore(":memory:");
    await syncTransfers(reader, store);
    await syncTransfers(reader, store);
    expect(froms).toEqual([null, 17 * day]);
    expect(store.allTransfers().map((t) => t.id)).toEqual(["a", "b"]);
    store.close();
  });
});
