import {
  Price, Qty, Usd, Millis, MarketSymbol,
  type LedgerEvent, type Position, type ReplayAnchor, type ReplayState,
} from "@hy/types";

export interface Lot {
  readonly qty: number;
  readonly entry: number;
  readonly funding: number;
}

export interface Mark {
  readonly price: number;
  readonly at: number;
}

export interface Book {
  readonly lots: Readonly<Record<string, Lot>>;
  readonly lastFill: Readonly<Record<string, Mark>>;
  readonly realized: number;
  readonly funding: number;
  readonly fees: number;
  readonly applied: number;
}

export type Marks = Readonly<Record<string, Mark>>;

export const EMPTY_BOOK: Book = { lots: {}, lastFill: {}, realized: 0, funding: 0, fees: 0, applied: 0 };

const FLAT_EPS = 1e-12;

export const eventAt = (e: LedgerEvent): number => (e.kind === "fill" ? e.fill.at : e.funding.at);

const KIND_ORDER = { fill: 0, funding: 1 } as const;

export function sortLedger(events: readonly LedgerEvent[]): LedgerEvent[] {
  return [...events].sort((a, b) => eventAt(a) - eventAt(b) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
}

const FLAT: Lot = { qty: 0, entry: 0, funding: 0 };

function applyFill(lot: Lot, signedQty: number, price: number): { lot: Lot; realized: number } {
  if (lot.qty === 0 || Math.sign(lot.qty) === Math.sign(signedQty)) {
    const size = Math.abs(lot.qty) + Math.abs(signedQty);
    const entry = (Math.abs(lot.qty) * lot.entry + Math.abs(signedQty) * price) / size;
    return { lot: { qty: lot.qty + signedQty, entry, funding: lot.funding }, realized: 0 };
  }
  const closed = Math.min(Math.abs(signedQty), Math.abs(lot.qty));
  const realized = (price - lot.entry) * closed * Math.sign(lot.qty);
  const qty = lot.qty + signedQty;
  if (Math.abs(qty) < FLAT_EPS) return { lot: FLAT, realized };
  const flipped = Math.sign(qty) !== Math.sign(lot.qty);
  return { lot: flipped ? { qty, entry: price, funding: 0 } : { qty, entry: lot.entry, funding: lot.funding }, realized };
}

export function apply(book: Book, event: LedgerEvent): Book {
  const applied = book.applied + 1;
  if (event.kind === "funding") {
    const { symbol, amount } = event.funding;
    const lot = book.lots[symbol];
    return {
      ...book,
      applied,
      funding: book.funding + amount,
      lots: lot === undefined || lot.qty === 0 ? book.lots : { ...book.lots, [symbol]: { ...lot, funding: lot.funding + amount } },
    };
  }
  const { fill } = event;
  if (fill.market !== "perp") return { ...book, applied };
  const signed = fill.side === "buy" ? fill.quantity : -fill.quantity;
  const next = applyFill(book.lots[fill.symbol] ?? FLAT, signed, fill.price);
  const lots = { ...book.lots };
  if (next.lot.qty === 0) delete lots[fill.symbol];
  else lots[fill.symbol] = next.lot;
  return {
    lots,
    lastFill: { ...book.lastFill, [fill.symbol]: { price: fill.price, at: fill.at } },
    realized: book.realized + next.realized,
    funding: book.funding,
    fees: book.fees + fill.fee,
    applied,
  };
}

export function reduceLedger(events: readonly LedgerEvent[], from: Book = EMPTY_BOOK): Book {
  return events.reduce(apply, from);
}

export function markOf(book: Book, marks: Marks, symbol: string): number {
  const fill = book.lastFill[symbol];
  const candle = marks[symbol];
  if (fill === undefined) return candle?.price ?? 0;
  if (candle === undefined) return fill.price;
  return candle.at > fill.at ? candle.price : fill.price;
}

export const netPnl = (book: Book) => book.realized + book.funding - book.fees;

export function unrealized(book: Book, marks: Marks): number {
  let sum = 0;
  for (const [symbol, lot] of Object.entries(book.lots)) sum += (markOf(book, marks, symbol) - lot.entry) * lot.qty;
  return sum;
}

export function deriveBase(anchor: ReplayAnchor, end: Book): number {
  const marks: Record<string, Mark> = {};
  for (const [symbol, price] of Object.entries(anchor.marks)) marks[symbol] = { price, at: anchor.at };
  return anchor.equity - netPnl(end) - unrealized(end, marks);
}

export function toPositions(book: Book, marks: Marks): Position[] {
  return Object.entries(book.lots).map(([symbol, lot]) => {
    const mark = markOf(book, marks, symbol);
    const notional = Math.abs(lot.qty) * mark;
    return {
      symbol: MarketSymbol.parse(symbol),
      direction: lot.qty > 0 ? "long" : "short",
      quantity: Qty.parse(Math.abs(lot.qty)),
      entryPrice: Price.parse(lot.entry),
      markPrice: Price.parse(mark),
      breakEvenPrice: Price.parse(lot.entry),
      liquidationPrice: null,
      margin: "cross",
      leverage: null,
      notional: Usd.parse(notional),
      openPnl: Usd.parse((mark - lot.entry) * lot.qty),
      cumulativeFunding: Usd.parse(lot.funding),
    };
  });
}

export function snapshotAt(input: { book: Book; at: number; marks: Marks; base: number }): ReplayState {
  const { book, at, marks, base } = input;
  const positions = toPositions(book, marks);
  const gross = positions.reduce((s, p) => s + p.notional, 0);
  const net = positions.reduce((s, p) => s + (p.direction === "long" ? p.notional : -p.notional), 0);
  const openPnl = positions.reduce((s, p) => s + p.openPnl, 0);
  const equity = base + netPnl(book) + openPnl;
  return {
    at: Millis.parse(at),
    equity: Usd.parse(equity),
    positions,
    metrics: {
      grossNotional: Usd.parse(gross),
      netNotional: Usd.parse(net),
      leverage: equity > 0 ? gross / equity : null,
      openPnl: Usd.parse(openPnl),
    },
    totals: { realized: Usd.parse(book.realized), funding: Usd.parse(book.funding), fees: Usd.parse(book.fees) },
  };
}
