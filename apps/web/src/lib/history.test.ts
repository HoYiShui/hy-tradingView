import { describe, expect, it } from "vitest";
import { firstInterval, historyLimit } from "./history";

describe("historyLimit", () => {
  it("names both limits when the exchange has them", () => {
    expect(historyLimit({ candleDepthBars: 5000, fillDepth: 10_000 })).toBe("History limited to the last 5,000 bars per interval and 10,000 fills.");
  });
  it("names only the limit that exists", () => {
    expect(historyLimit({ candleDepthBars: 5000, fillDepth: null })).toBe("History limited to the last 5,000 bars per interval.");
  });
  it("says nothing when history is unlimited", () => {
    expect(historyLimit({ candleDepthBars: null, fillDepth: null })).toBeNull();
  });
});

describe("firstInterval", () => {
  it("prefers the first wanted interval the exchange serves", () => {
    expect(firstInterval(["15m", "1h"], ["5m", "1h"])).toBe("1h");
  });
  it("falls back to the first available interval", () => {
    expect(firstInterval(["15m"], ["1d", "1w"])).toBe("1d");
  });
});
