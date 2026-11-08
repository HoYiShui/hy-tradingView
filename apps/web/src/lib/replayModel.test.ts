import { describe, expect, it } from "vitest";
import { MarketSymbol, Millis, Price, Qty, Usd, type ReplayPayload } from "@hy/types";
import { buildModel, frameAt } from "./replayModel";
import { START } from "@hy/replay";

const BTC = MarketSymbol.parse("BTC_USDC_PERP");
const H = 3_600_000;
const px = (n: number) => Price.parse(n);
const candle = (i: number, close: number): ReplayPayload["candles"][number] => [Millis.parse(i * H), px(close), px(close), px(close), px(close), Qty.parse(1)];
const payload: ReplayPayload = {
  interval: "1h",
  symbol: BTC,
  anchor: { at: Millis.parse(10 * H), equity: Usd.parse(1010), marks: { [BTC]: px(130) } },
  fills: [
    ["1", BTC, 1, px(100), Qty.parse(2), Usd.parse(1), Millis.parse(2 * H)],
    ["2", BTC, -1, px(120), Qty.parse(1), Usd.parse(1), Millis.parse(5 * H)],
  ],
  funding: [[BTC, Millis.parse(6 * H), Usd.parse(-0.5)]],
  candles: Array.from({ length: 11 }, (_, i) => candle(i, 100 + i * 3)),
  orders: [[BTC, 1, 0, px(99), Qty.parse(1), Millis.parse(H), Millis.parse(2 * H), 0]],
  candlesComplete: true,
};

describe("replay model", () => {
  const model = buildModel(payload);

  it("lands the final frame exactly on the anchor equity", () => {
    const f = frameAt(model, START, model.end);
    expect(f.state.equity).toBeCloseTo(1010);
    expect(f.state.positions[0]).toMatchObject({ quantity: 1, entryPrice: 100, markPrice: 130 });
  });

  it("reconstructs earlier equity from the start balance, marking to the candle", () => {
    const f = frameAt(model, START, 3 * H);
    expect(f.fillCount).toBe(1);
    expect(f.state.positions[0]).toMatchObject({ quantity: 2, markPrice: 109 });
    expect(f.state.equity).toBeCloseTo(model.base - 1 + 2 * (109 - 100));
    expect(f.openOrders).toHaveLength(0);
  });

  it("shows an order as open only in its span and is order independent when scrubbing back", () => {
    const forward = frameAt(model, frameAt(model, START, 8 * H).cursor, 1.5 * H);
    expect(forward.openOrders).toHaveLength(1);
    expect(forward.state).toEqual(frameAt(model, START, 1.5 * H).state);
  });
});

describe("fractional clock", () => {
  it("accepts a clock value between milliseconds", () => {
    const model = buildModel(payload);
    expect(frameAt(model, START, 3 * H + 0.7).t).toBe(3 * H);
  });
});
