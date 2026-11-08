import { describe, expect, it } from "vitest";
import { MarketSymbol, Millis, Price, Qty, Usd, type LedgerEvent } from "@hy/types";
import { deriveBase, netPnl, reduceLedger, snapshotAt, sortLedger, type Marks } from "./reducer.js";
import { buildTimeline, seek, START } from "./timeline.js";

const BTC = MarketSymbol.parse("BTC_USDC_PERP");
const ETH = MarketSymbol.parse("ETH_USDC_PERP");
let n = 0;
const fill = (at: number, side: "buy" | "sell", quantity: number, price: number, fee = 0, symbol = BTC, market: "perp" | "spot" = "perp"): LedgerEvent => ({
  kind: "fill",
  fill: {
    id: String(++n), orderId: "o", symbol, side, price: Price.parse(price), quantity: Qty.parse(quantity),
    fee: Usd.parse(fee), liquidity: "taker", market, closedPnl: null, at: Millis.parse(at),
  },
});
const funding = (at: number, amount: number, symbol = BTC): LedgerEvent => ({
  kind: "funding",
  funding: { symbol, at: Millis.parse(at), amount: Usd.parse(amount) },
});
const mark = (price: number, at: number, symbol = BTC): Marks => ({ [symbol]: { price, at } });

describe("reduceLedger", () => {
  it("opens a long and averages the entry on a second buy", () => {
    const b = reduceLedger([fill(1, "buy", 1, 100), fill(2, "buy", 3, 200)]);
    expect(b.lots[BTC]).toMatchObject({ qty: 4, entry: 175 });
    expect(b.realized).toBe(0);
  });

  it("realizes pnl on a partial close and keeps the entry", () => {
    const b = reduceLedger([fill(1, "buy", 2, 100), fill(2, "sell", 1, 130)]);
    expect(b.lots[BTC]).toMatchObject({ qty: 1, entry: 100 });
    expect(b.realized).toBe(30);
  });

  it("realizes a short in the right direction", () => {
    const b = reduceLedger([fill(1, "sell", 2, 100), fill(2, "buy", 2, 80)]);
    expect(b.lots[BTC]).toBeUndefined();
    expect(b.realized).toBe(40);
  });

  it("flips through zero: closes the old side then opens the rest at the fill price", () => {
    const b = reduceLedger([fill(1, "buy", 1, 100), fill(2, "sell", 3, 120)]);
    expect(b.realized).toBe(20);
    expect(b.lots[BTC]).toMatchObject({ qty: -2, entry: 120, funding: 0 });
  });

  it("accumulates fees and funding, and funding follows the open lot only", () => {
    const b = reduceLedger([funding(0, 5), fill(1, "buy", 1, 100, 0.5), funding(2, -0.25), fill(3, "sell", 1, 100, 0.5), funding(4, 1)]);
    expect(b.fees).toBe(1);
    expect(b.funding).toBe(5.75);
    expect(b.lots[BTC]).toBeUndefined();
    expect(netPnl(b)).toBe(4.75);
  });

  it("ignores spot fills: no perp position and no perp fee", () => {
    const b = reduceLedger([fill(1, "buy", 5, 10, 0.1, MarketSymbol.parse("SOL_USDC"), "spot")]);
    expect(b.lots).toEqual({});
    expect(b.fees).toBe(0);
  });

  it("orders funding after fills at the same instant", () => {
    const sorted = sortLedger([funding(5, 1), fill(5, "buy", 1, 100), fill(4, "buy", 1, 100)]);
    expect(sorted.map((e) => e.kind)).toEqual(["fill", "fill", "funding"]);
  });
});

describe("snapshotAt", () => {
  const events = [fill(1, "buy", 2, 100, 1), fill(2, "sell", 1, 110, 1), funding(3, -2)];
  const book = reduceLedger(events);

  it("marks the open lot to the candle and derives leverage", () => {
    const s = snapshotAt({ book, at: 4, marks: mark(120, 4), base: 1000 });
    expect(s.positions).toHaveLength(1);
    expect(s.positions[0]).toMatchObject({ direction: "long", quantity: 1, entryPrice: 100, markPrice: 120, openPnl: 20, notional: 120 });
    expect(s.totals).toEqual({ realized: 10, funding: -2, fees: 2 });
    expect(s.equity).toBe(1000 + 10 - 2 - 2 + 20);
    expect(s.metrics.leverage).toBeCloseTo(120 / s.equity);
  });

  it("falls back to the last fill price when the candle is older than the last fill", () => {
    const s = snapshotAt({ book, at: 4, marks: mark(999, 0), base: 1000 });
    expect(s.positions[0]?.markPrice).toBe(110);
  });

  it("derives the starting balance so the final replayed equity equals the anchor", () => {
    const anchor = { at: Millis.parse(10), equity: Usd.parse(1050), marks: { [BTC]: Price.parse(125) } };
    const base = deriveBase(anchor, book);
    const end = snapshotAt({ book, at: 10, marks: mark(125, 10), base });
    expect(end.equity).toBeCloseTo(1050);
    const before = snapshotAt({ book: reduceLedger(events.slice(0, 1)), at: 1, marks: mark(100, 1), base });
    expect(before.equity).toBeCloseTo(base - 1);
    expect(before.metrics.leverage).toBeCloseTo(200 / before.equity);
  });

  it("tracks two symbols independently", () => {
    const b = reduceLedger([fill(1, "buy", 1, 100), fill(2, "sell", 2, 50, 0, ETH)]);
    const s = snapshotAt({ book: b, at: 3, marks: { ...mark(100, 3), ...mark(40, 3, ETH) }, base: 0 });
    expect(s.positions.map((p) => [p.symbol, p.direction])).toEqual([[BTC, "long"], [ETH, "short"]]);
    expect(s.metrics.netNotional).toBeCloseTo(100 - 80);
    expect(s.metrics.openPnl).toBeCloseTo(20);
  });
});

describe("timeline seek", () => {
  const events: LedgerEvent[] = [];
  for (let i = 0; i < 40; i++) events.push(fill(i * 10 + 1, i % 2 === 0 ? "buy" : "sell", 1 + (i % 3), 100 + i, 0.1));
  const sorted = sortLedger(events);
  const tl = buildTimeline(sorted, 7);

  it("matches a from-scratch reduction for forward, backward and random seeks", () => {
    let cursor = START;
    for (const t of [0, 55, 56, 300, 120, 399, 5, 400, 250, 250, 1]) {
      cursor = seek(tl, cursor, t);
      const scratch = reduceLedger(sorted.filter((e) => (e.kind === "fill" ? e.fill.at : e.funding.at) <= t));
      expect(cursor.book).toEqual(scratch);
    }
  });
});
