import type { OrderRecord, OrderSpan } from "@hy/types";

export const UNKNOWN_CLOSE_CAP_MS = 6 * 3_600_000;

const FINAL_UNFILLED = new Set(["Cancelled", "Expired", "TriggerFailed"]);

export function orderSpans(input: {
  orders: readonly OrderRecord[];
  lastFillAt: ReadonlyMap<string, number>;
  now: number;
}): OrderSpan[] {
  const resting = input.orders
    .filter((o) => o.kind !== "market" && o.price !== null)
    .sort((a, b) => a.createdAt - b.createdAt);
  const nextSameBook = new Map<string, number>();
  const nextOf = new Map<string, number>();
  for (let i = resting.length - 1; i >= 0; i--) {
    const o = resting[i];
    if (o === undefined) continue;
    const book = `${o.symbol}:${o.side}`;
    const next = nextSameBook.get(book);
    if (next !== undefined) nextOf.set(o.id, next);
    nextSameBook.set(book, o.createdAt);
  }
  const spans: OrderSpan[] = [];
  for (const o of resting) {
    if (o.price === null || (o.kind !== "limit" && o.kind !== "trigger")) continue;
    const filledAt = input.lastFillAt.get(o.id);
    const open = o.status === "New" || o.status === "TriggerPending" || o.status === "PartiallyFilled";
    let to: number;
    let estimated: boolean;
    if (o.status === "Filled" && filledAt !== undefined) {
      to = filledAt;
      estimated = false;
    } else if (open) {
      to = input.now;
      estimated = false;
    } else if (FINAL_UNFILLED.has(o.status) || o.status === "Filled") {
      const cap = o.createdAt + UNKNOWN_CLOSE_CAP_MS;
      to = Math.min(nextOf.get(o.id) ?? cap, cap);
      estimated = true;
    } else {
      continue;
    }
    spans.push({
      symbol: o.symbol,
      side: o.side,
      kind: o.kind,
      price: o.price,
      quantity: o.quantity,
      from: o.createdAt,
      to: Math.max(to, o.createdAt) as OrderSpan["to"],
      estimated,
    });
  }
  return spans;
}

export function openAt(spans: readonly OrderSpan[], at: number): OrderSpan[] {
  return spans.filter((s) => s.from <= at && at < s.to);
}
