import { describe, expect, it } from "vitest";
import { leverageX, percent, price, qty, relativeAge, shortSymbol, signedUsd, signOf, usd } from "./format";

describe("format", () => {
  it("formats usd to 2dp and never shows negative zero", () => {
    expect(usd(1234.5)).toBe("$1,234.50");
    expect(usd(-0)).toBe("$0.00");
  });
  it("signs usd with an explicit character", () => {
    expect(signedUsd(3.456)).toBe("+$3.46");
    expect(signedUsd(-3)).toBe("-$3.00");
    expect(signedUsd(0)).toBe("$0.00");
  });
  it("classifies sign", () => {
    expect([signOf(1), signOf(-1), signOf(0)]).toEqual(["gain", "loss", "flat"]);
  });
  it("keeps price tick precision and caps qty at 5dp", () => {
    expect(price(0.00012345)).toBe("0.00012345");
    expect(price(67000)).toBe("67,000.00");
    expect(qty(0.123456789)).toBe("0.12346");
    expect(qty(2)).toBe("2");
  });
  it("handles null leverage and margin fraction", () => {
    expect(leverageX(null)).toBe("-");
    expect(leverageX(1.234)).toBe("1.23x");
    expect(percent(null)).toBe("-");
    expect(percent(0.1234)).toBe("12.34%");
  });
  it("describes age relative to now", () => {
    const now = 1_000_000_000;
    expect(relativeAge(now - 2000, now)).toBe("just now");
    expect(relativeAge(now - 30_000, now)).toBe("30s ago");
    expect(relativeAge(now - 5 * 60_000, now)).toBe("5m ago");
    expect(relativeAge(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(relativeAge(now + 5000, now)).toBe("just now");
  });
  it("shortens perp symbols", () => {
    expect(shortSymbol("BTC_USDC_PERP")).toBe("BTC-PERP");
    expect(shortSymbol("SOL_USDC")).toBe("SOL_USDC");
  });
});
