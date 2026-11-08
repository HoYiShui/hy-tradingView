import { describe, expect, it } from "vitest";
import { MarketSymbol, Millis } from "@hy/types";
import { openStore } from "./db.js";
import type { ExchangeReader } from "./exchange.js";
import { createCandleService, INTERVAL_MS } from "./history.js";

const symbol = MarketSymbol.parse("BTC_USDC_PERP");

function fakeReader() {
  const calls: { from: number; to: number }[] = [];
  const reader = {
    async fetchCandles({ from, to }: { from: number; to: number }) {
      calls.push({ from, to });
      await new Promise((r) => setTimeout(r, 5));
      return [{ start: Millis.parse(to), open: 1, high: 1, low: 1, close: 1, volume: 1 }] as never;
    },
  } as unknown as ExchangeReader;
  return { reader, calls };
}

describe("candle service", () => {
  it("serves many concurrent browsers with a single upstream request", async () => {
    const { reader, calls } = fakeReader();
    const store = openStore(":memory:");
    const service = createCandleService({ reader, store, symbol, now: () => 10_000_000 });
    await Promise.all(Array.from({ length: 50 }, () => service.get("1h", null)));
    await service.get("1h", null);
    expect(calls).toHaveLength(1);
    store.close();
  });

  it("refreshes again once the minimum gap has passed, resuming from the newest stored candle", async () => {
    const { reader, calls } = fakeReader();
    const store = openStore(":memory:");
    let t = 10_000_000;
    const service = createCandleService({ reader, store, symbol, now: () => t });
    await service.get("1m", null);
    t += 3000;
    await service.get("1m", null);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.from).toBe(calls[0]?.to);
    store.close();
  });

  it("splits a long gap into bounded upstream requests", async () => {
    const { reader, calls } = fakeReader();
    const store = openStore(":memory:");
    store.saveCandles(symbol, "1m", [{ start: Millis.parse(0), open: 1, high: 1, low: 1, close: 1, volume: 1 } as never]);
    const service = createCandleService({ reader, store, symbol, now: () => 2500 * INTERVAL_MS["1m"] });
    await service.get("1m", null);
    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const c of calls) expect(c.to - c.from).toBeLessThanOrEqual(1000 * INTERVAL_MS["1m"]);
    store.close();
  });
});
