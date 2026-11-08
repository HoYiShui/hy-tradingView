import { describe, expect, it } from "vitest";
import { INTERVAL_MS } from "./candles";
import { candle, fill } from "./fixtures";
import { buildFillMarkers, countUnmarked } from "./markers";
import { mergeCandles } from "./candles";

const HOUR = INTERVAL_MS["1h"];
const T0 = 1_700_000_000_000 - (1_700_000_000_000 % HOUR);
const hourly = [0, 1, 2, 3].map((i) => candle(T0 + i * HOUR));

describe("buildFillMarkers", () => {
  it("snaps a fill to the candle containing it", () => {
    const [m] = buildFillMarkers([fill({ at: T0 + 2 * HOUR + 59 * 60_000 })], hourly, "1h");
    expect(m?.time).toBe((T0 + 2 * HOUR) / 1000);
  });

  it("snaps differently per interval", () => {
    const at = T0 + HOUR + 7 * 60_000;
    const min5 = Array.from({ length: 24 }, (_, i) => candle(T0 + i * INTERVAL_MS["5m"]));
    const [m5] = buildFillMarkers([fill({ at })], min5, "5m");
    const [m1h] = buildFillMarkers([fill({ at })], hourly, "1h");
    expect(m5?.time).toBe((T0 + HOUR + 5 * 60_000) / 1000);
    expect(m1h?.time).toBe((T0 + HOUR) / 1000);
  });

  it("drops fills outside the loaded candle range or in a gap", () => {
    const gappy = [candle(T0), candle(T0 + 3 * HOUR)];
    const fills = [fill({ at: T0 - 1 }), fill({ at: T0 + 2 * HOUR }), fill({ at: T0 + 4 * HOUR })];
    expect(buildFillMarkers(fills, gappy, "1h")).toEqual([]);
  });

  it("ignores other symbols", () => {
    expect(buildFillMarkers([fill({ symbol: "ETH_USDC_PERP", at: T0 })], hourly, "1h")).toEqual([]);
  });

  it("puts buys below and sells above the bar, with a short label and the full price and qty in the detail", () => {
    const ms = buildFillMarkers(
      [fill({ side: "buy", at: T0, price: 100.5, quantity: 0.25 }), fill({ id: "f2", side: "sell", at: T0 + HOUR, price: 110, quantity: 1 })],
      hourly,
      "1h",
    );
    expect(ms.map((m) => [m.position, m.shape])).toEqual([["belowBar", "arrowUp"], ["aboveBar", "arrowDown"]]);
    expect(ms[0]?.text).toBe("B 0.25");
    expect(ms[0]?.detail).toBe("Buy 0.25 @ 100.50");
  });

  it("merges same-side fills in one candle into a weighted average", () => {
    const ms = buildFillMarkers(
      [fill({ at: T0, price: 100, quantity: 1 }), fill({ id: "f2", at: T0 + 1000, price: 110, quantity: 3 })],
      hourly,
      "1h",
    );
    expect(ms).toHaveLength(1);
    expect(ms[0]?.text).toBe("B 4");
    expect(ms[0]?.detail).toBe("Buy 4 @ 107.50 (2 fills)");
  });

  it("returns nothing for empty inputs", () => {
    expect(buildFillMarkers([], hourly, "1h")).toEqual([]);
    expect(buildFillMarkers([fill({ at: T0 })], [], "1h")).toEqual([]);
  });
});

describe("markers across a prepend of older candles", () => {
  const older = [-3, -2, -1].map((i) => candle(T0 + i * HOUR));
  const fills = [fill({ at: T0 - 2 * HOUR + 60_000 }), fill({ at: T0 + HOUR + 60_000 })];

  it("leaves old fills unmarked but counted until their candles load, then marks them", () => {
    expect(buildFillMarkers(fills, hourly, "1h")).toHaveLength(1);
    expect(countUnmarked(fills, hourly, "1h")).toBe(1);
    const merged = mergeCandles(hourly, older);
    expect(buildFillMarkers(fills, merged, "1h").map((m) => m.time)).toEqual([(T0 - 2 * HOUR) / 1000, (T0 + HOUR) / 1000]);
    expect(countUnmarked(fills, merged, "1h")).toBe(0);
  });

  it("ignores fills on other symbols when counting", () => {
    expect(countUnmarked([fill({ at: 0, symbol: "ETH_USDC_PERP" as never })], hourly, "1h")).toBe(0);
  });
});
