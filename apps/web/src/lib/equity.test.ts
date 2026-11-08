import { describe, expect, it } from "vitest";
import { Millis, Usd, type EquityPoint } from "@hy/types";
import { equityChange, shapeEquity } from "./equity";

const p = (ts: number, equity: number): EquityPoint => ({ ts: Millis.parse(ts), equity: Usd.parse(equity), openPnl: Usd.parse(0), notional: Usd.parse(0) });

describe("equity shaping", () => {
  it("converts milliseconds to chart seconds", () => {
    expect(shapeEquity([p(60_000, 5)]).line).toEqual([{ time: 60, value: 5 }]);
  });

  it("reports no change for zero or one point", () => {
    expect(equityChange([])).toBeNull();
    expect(equityChange([p(1000, 10)])).toBeNull();
  });

  it("reports absolute and percent change across the range", () => {
    const c = equityChange([p(1000, 100), p(2000, 90), p(3000, 110)]);
    expect(c).toMatchObject({ from: 100, to: 110, delta: 10 });
    expect(c?.pct).toBeCloseTo(10, 9);
  });
});
