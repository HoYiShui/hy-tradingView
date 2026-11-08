import { Candle, DailyPnl, Fill, MarketSymbol, OpenOrder, Position } from "@hy/types";

export const BTC = MarketSymbol.parse("BTC_USDC_PERP");

export function candle(start: number, close = 100): Candle {
  return Candle.parse({ start, open: close, high: close + 1, low: close - 1, close, volume: 1 });
}

export function fill(over: Partial<Record<keyof Fill, unknown>>): Fill {
  return Fill.parse({
    id: "f1", orderId: "o1", symbol: BTC, side: "buy", price: 100, quantity: 1,
    fee: 0.1, liquidity: "taker", at: 0, ...over,
  });
}

export function position(over: Partial<Record<keyof Position, unknown>> = {}): Position {
  return Position.parse({
    symbol: BTC, direction: "long", quantity: 0.5, entryPrice: 100, markPrice: 101,
    breakEvenPrice: 100.1, liquidationPrice: 50, notional: 50, openPnl: 0.5,
    cumulativeFunding: 0, ...over,
  });
}

export function limitOrder(over: Record<string, unknown> = {}): OpenOrder {
  return OpenOrder.parse({
    id: "l1", symbol: BTC, side: "buy", createdAt: 0, reduceOnly: false, kind: "limit",
    price: 90, quantity: 2, executedQuantity: 0.5, postOnly: true, ...over,
  });
}

export function triggerOrder(over: Record<string, unknown> = {}): OpenOrder {
  return OpenOrder.parse({
    id: "t1", symbol: BTC, side: "sell", createdAt: 0, reduceOnly: true, kind: "trigger",
    triggerPrice: 80, execution: "market", quantity: "all", ...over,
  });
}

export function day(d: string, total: number, cumulative: number): DailyPnl {
  return DailyPnl.parse({ day: d, trading: total, funding: 0, total, cumulative });
}
