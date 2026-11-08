import { describe, expect, it } from "vitest";
import { BTC, limitOrder, position, triggerOrder } from "./fixtures";
import { buildPriceLines } from "./orders";

describe("buildPriceLines", () => {
  it("renders limit and trigger orders distinctly", () => {
    const lines = buildPriceLines([limitOrder(), triggerOrder()], [], BTC);
    expect(lines).toEqual([
      expect.objectContaining({ price: 90, style: "dashed", title: "BUY limit 1.5" }),
      expect.objectContaining({ price: 80, style: "dotted", title: "SELL trigger market all" }),
    ]);
  });
  it("adds entry and liquidation lines for the symbol only", () => {
    const lines = buildPriceLines([], [position(), position({ symbol: "ETH_USDC_PERP" })], BTC);
    expect(lines.map((l) => [l.key, l.price])).toEqual([[`entry:${BTC}`, 100], [`liq:${BTC}`, 50]]);
  });
  it("skips liquidation when null and other-symbol orders", () => {
    const lines = buildPriceLines([limitOrder({ symbol: "ETH_USDC_PERP" })], [position({ liquidationPrice: null })], BTC);
    expect(lines).toHaveLength(1);
  });
  it("is empty for empty inputs", () => {
    expect(buildPriceLines([], [], BTC)).toEqual([]);
  });
});
