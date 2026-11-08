import { describe, expect, it } from "vitest";
import { MarketSymbol, Millis, Price, Qty, type OrderRecord } from "@hy/types";
import { openAt, orderSpans, UNKNOWN_CLOSE_CAP_MS } from "./orders.js";
import { decodePayload, encodeCandles, encodeFills, encodeFunding, encodeOrders, encodeTransfers } from "./payload.js";

const BTC = MarketSymbol.parse("BTC_USDC_PERP");
const order = (id: string, createdAt: number, status: OrderRecord["status"], side: "buy" | "sell" = "buy", kind: OrderRecord["kind"] = "limit"): OrderRecord => ({
  id, symbol: BTC, side, kind, price: Price.parse(100), quantity: Qty.parse(1), executedQuantity: Qty.parse(0), status, createdAt: Millis.parse(createdAt),
});

describe("orderSpans", () => {
  it("closes a filled order at its last fill, exactly", () => {
    const [s] = orderSpans({ orders: [order("a", 10, "Filled")], lastFillAt: new Map([["a", 50]]), now: 1000 });
    expect(s).toMatchObject({ from: 10, to: 50, estimated: false });
  });

  it("estimates a cancelled order as open until the next order on the same book", () => {
    const spans = orderSpans({
      orders: [order("a", 10, "Cancelled"), order("b", 40, "Cancelled", "sell"), order("c", 70, "Filled")],
      lastFillAt: new Map([["c", 90]]),
      now: 1000,
    });
    expect(spans.find((s) => s.from === 10)).toMatchObject({ to: 70, estimated: true });
    expect(spans.find((s) => s.from === 40)).toMatchObject({ to: 40 + UNKNOWN_CLOSE_CAP_MS, estimated: true });
  });

  it("keeps still-open orders open until now and skips market orders", () => {
    const spans = orderSpans({ orders: [order("a", 10, "New"), order("m", 20, "Filled", "buy", "market")], lastFillAt: new Map(), now: 500 });
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ to: 500, estimated: false });
  });

  it("reports an order open only inside its half open interval", () => {
    const spans = orderSpans({ orders: [order("a", 10, "Filled")], lastFillAt: new Map([["a", 50]]), now: 1000 });
    expect([9, 10, 49, 50].map((t) => openAt(spans, t).length)).toEqual([0, 1, 1, 0]);
  });
});

describe("payload codec", () => {
  it("round trips fills, funding, candles and orders and sorts the ledger", () => {
    const fill = { id: "1", orderId: "x", symbol: BTC, side: "sell" as const, price: Price.parse(5), quantity: Qty.parse(2), fee: 0.1 as never, liquidity: "taker" as const, market: "perp" as const, closedPnl: null, at: Millis.parse(20) };
    const spans = orderSpans({ orders: [order("a", 10, "Filled")], lastFillAt: new Map([["a", 50]]), now: 1000 });
    const d = decodePayload({
      interval: "1h", symbol: BTC, anchor: { at: Millis.parse(0), equity: 1 as never, marks: {} },
      fills: encodeFills([fill]), funding: encodeFunding([{ symbol: BTC, at: Millis.parse(20), amount: -1 as never }]),
      transfers: encodeTransfers([{ at: Millis.parse(20), amount: 50 as never }, { at: Millis.parse(5), amount: -3 as never }]), excludedTransfers: 2,
      candles: encodeCandles([{ start: Millis.parse(0), open: Price.parse(1), high: Price.parse(2), low: Price.parse(1), close: Price.parse(2), volume: Qty.parse(3) }]),
      orders: encodeOrders(spans), candlesComplete: true,
    });
    expect(d.ledger.map((e) => e.kind)).toEqual(["transfer", "fill", "funding", "transfer"]);
    expect(d.fills[0]).toMatchObject({ side: "sell", price: 5, quantity: 2, at: 20 });
    expect(d.orders[0]).toEqual(spans[0]);
    expect(d.candles[0]).toMatchObject({ start: 0, close: 2, volume: 3 });
  });
});
