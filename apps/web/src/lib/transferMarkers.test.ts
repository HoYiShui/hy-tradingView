import { describe, expect, it } from "vitest";
import { Millis, Usd, type EquityPoint } from "@hy/types";
import { transferMarkers } from "./transferMarkers";

const curve: EquityPoint[] = [0, 10, 20, 30].map((t) => ({ ts: Millis.parse(t), equity: Usd.parse(0), openPnl: Usd.parse(0), notional: Usd.parse(0) }));

describe("transfer markers", () => {
  it("places a deposit below and a withdrawal above the curve point at or before the transfer", () => {
    const m = transferMarkers(curve, [{ at: 14, amount: 50 }, { at: 25, amount: -20 }]);
    expect(m.map((x) => [x.time, x.position, x.shape])).toEqual([[10, "belowBar", "arrowUp"], [20, "aboveBar", "arrowDown"]]);
  });

  it("collapses transfers of one direction that share a curve point", () => {
    const m = transferMarkers(curve, [{ at: 11, amount: 1 }, { at: 12, amount: 2 }, { at: 13, amount: -1 }]);
    expect(m).toHaveLength(2);
  });

  it("skips a transfer before the first curve point", () => {
    expect(transferMarkers(curve, [{ at: -5, amount: 1 }])).toEqual([]);
  });
});
