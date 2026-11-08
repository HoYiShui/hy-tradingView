import { describe, expect, it } from "vitest";
import { Fill, MarketSymbol, Millis, Price, Qty, Usd, type AccountSnapshot } from "@hy/types";
import { decodePayload } from "@hy/replay";
import { openStore } from "./db.js";
import { buildReplayPayload } from "./replay.js";

const BTC = MarketSymbol.parse("BTC_USDC_PERP");
const H = 3_600_000;
const fill = (id: string, at: number): Fill => ({
  id, orderId: `o${id}`, symbol: BTC, side: "buy", price: Price.parse(100), quantity: Qty.parse(1), fee: Usd.parse(0.1), liquidity: "maker", at: Millis.parse(at),
});
const snapshot = (asOf: number): AccountSnapshot => ({
  exchange: "backpack", asOf: Millis.parse(asOf),
  account: { equity: Usd.parse(1000), availableEquity: Usd.parse(0), lockedEquity: Usd.parse(0), initialMarginFraction: 0, maintenanceMarginFraction: 0, marginFraction: null, leverageLimit: 50, liquidating: false },
  positions: [], openOrders: [], metrics: { grossNotional: Usd.parse(0), netNotional: Usd.parse(0), leverage: 0, openPnl: Usd.parse(0) },
});

describe("buildReplayPayload", () => {
  it("returns fills up to the snapshot, candles from the first fill and the equity anchor", () => {
    const store = openStore(":memory:");
    store.saveFills([fill("1", 5 * H + 10), fill("2", 9 * H), fill("3", 20 * H)]);
    store.saveCandles(BTC, "1h", Array.from({ length: 30 }, (_, i) => ({ start: Millis.parse(i * H), open: Price.parse(1), high: Price.parse(2), low: Price.parse(1), close: Price.parse(2), volume: Qty.parse(1) })));
    const p = buildReplayPayload({ store, snapshot: snapshot(10 * H), interval: "1h", symbol: BTC });
    const d = decodePayload(p);
    expect(d.fills.map((f) => f.id)).toEqual(["1", "2"]);
    expect(d.candles[0]?.start).toBe(4 * H);
    expect(p.anchor).toMatchObject({ at: 10 * H, equity: 1000 });
    expect(p.candlesComplete).toBe(true);
    store.close();
  });
});
