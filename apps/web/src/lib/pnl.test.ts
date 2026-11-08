import { describe, expect, it } from "vitest";
import { day } from "./fixtures";
import { shapePnl } from "./pnl";

describe("shapePnl", () => {
  it("builds bars and a cumulative line from daily rows", () => {
    const s = shapePnl([day("2026-01-01", 5, 5), day("2026-01-02", -2, 3)]);
    expect(s.bars.map((b) => b.value)).toEqual([5, -2]);
    expect(s.bars[0]?.color).not.toBe(s.bars[1]?.color);
    expect(s.cumulative).toEqual([{ time: "2026-01-01", value: 5 }, { time: "2026-01-02", value: 3 }]);
    expect(s.byDay.get("2026-01-02")?.total).toBe(-2);
  });
  it("is empty for no days", () => {
    const s = shapePnl([]);
    expect(s.bars).toEqual([]);
    expect(s.cumulative).toEqual([]);
  });
});
