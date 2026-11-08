import { describe, expect, it } from "vitest";
import { MarketSymbol, Price, Qty, Usd, type Position } from "@hy/types";
import { deriveMetrics } from "./domain.js";

const position = (direction: "long" | "short", notional: number, openPnl: number): Position => ({
  symbol: MarketSymbol.parse("BTC_USDC_PERP"),
  direction,
  quantity: Qty.parse(1),
  entryPrice: Price.parse(100),
  markPrice: Price.parse(100),
  breakEvenPrice: Price.parse(100),
  liquidationPrice: null,
  notional: Usd.parse(notional),
  openPnl: Usd.parse(openPnl),
  cumulativeFunding: Usd.parse(0),
});

describe("deriveMetrics", () => {
  it("computes cross leverage as total absolute notional over net equity", () => {
    const m = deriveMetrics(Usd.parse(1000), [position("long", 3000, 10), position("short", 1000, -4)]);
    expect(m.leverage).toBe(4);
    expect(m.grossNotional).toBe(4000);
    expect(m.netNotional).toBe(2000);
    expect(m.openPnl).toBe(6);
  });

  it("reports zero leverage for an account with no positions", () => {
    expect(deriveMetrics(Usd.parse(500), [])).toMatchObject({ leverage: 0, grossNotional: 0, openPnl: 0 });
  });

  it("reports no leverage when equity is not positive", () => {
    expect(deriveMetrics(Usd.parse(0), [position("long", 100, 0)]).leverage).toBeNull();
    expect(deriveMetrics(Usd.parse(-5), [position("long", 100, 0)]).leverage).toBeNull();
  });
});
