import {
  type Candle, type Fill, type FundingEvent, type LedgerEvent, type OrderSpan, type ReplayPayload,
} from "@hy/types";
import { sortLedger } from "./reducer.js";

export type Payload = ReplayPayload;

export function encodeFills(fills: readonly Fill[]): Payload["fills"] {
  return fills.map((f) => [f.id, f.symbol, f.side === "buy" ? 1 : -1, f.price, f.quantity, f.fee, f.at]);
}

export function encodeFunding(funding: readonly FundingEvent[]): Payload["funding"] {
  return funding.map((f) => [f.symbol, f.at, f.amount]);
}

export function encodeCandles(candles: readonly Candle[]): Payload["candles"] {
  return candles.map((c) => [c.start, c.open, c.high, c.low, c.close, c.volume]);
}

export function encodeOrders(spans: readonly OrderSpan[]): Payload["orders"] {
  return spans.map((s) => [s.symbol, s.side === "buy" ? 1 : -1, s.kind === "limit" ? 0 : 1, s.price, s.quantity, s.from, s.to, s.estimated ? 1 : 0]);
}

export interface Decoded {
  ledger: LedgerEvent[];
  fills: Fill[];
  candles: Candle[];
  orders: OrderSpan[];
}

export function decodePayload(p: Payload): Decoded {
  const fills = p.fills.map(
    ([id, symbol, dir, price, quantity, fee, at]): Fill => ({
      id, orderId: "", symbol, side: dir > 0 ? "buy" : "sell", price, quantity, fee, liquidity: "taker", market: "perp", closedPnl: null, at,
    }),
  );
  const ledger = sortLedger([
    ...fills.map((fill): LedgerEvent => ({ kind: "fill", fill })),
    ...p.funding.map(([symbol, at, amount]): LedgerEvent => ({ kind: "funding", funding: { symbol, at, amount } })),
  ]);
  return {
    ledger,
    fills: ledger.flatMap((e) => (e.kind === "fill" ? [e.fill] : [])),
    candles: p.candles.map(([start, open, high, low, close, volume]): Candle => ({ start, open, high, low, close, volume })),
    orders: p.orders.map(
      ([symbol, dir, kind, price, quantity, from, to, estimated]): OrderSpan => ({
        symbol, side: dir > 0 ? "buy" : "sell", kind: kind === 0 ? "limit" : "trigger", price, quantity, from, to, estimated: estimated === 1,
      }),
    ),
  };
}

