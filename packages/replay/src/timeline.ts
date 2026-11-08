import type { LedgerEvent } from "@hy/types";
import { apply, EMPTY_BOOK, eventAt, type Book } from "./reducer.js";

export interface Timeline {
  readonly events: readonly LedgerEvent[];
  readonly every: number;
  readonly checkpoints: readonly Book[];
}

export interface Cursor {
  readonly index: number;
  readonly book: Book;
}

export const START: Cursor = { index: 0, book: EMPTY_BOOK };

export function buildTimeline(events: readonly LedgerEvent[], every = 512): Timeline {
  const checkpoints: Book[] = [EMPTY_BOOK];
  let book = EMPTY_BOOK;
  events.forEach((e, i) => {
    book = apply(book, e);
    if ((i + 1) % every === 0) checkpoints.push(book);
  });
  return { events, every, checkpoints };
}

export function countUpTo(events: readonly LedgerEvent[], at: number): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const e = events[mid];
    if (e !== undefined && eventAt(e) <= at) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function seek(timeline: Timeline, cursor: Cursor, at: number): Cursor {
  const target = countUpTo(timeline.events, at);
  if (target === cursor.index) return cursor;
  let { index, book } = cursor;
  if (target < index) {
    const k = Math.floor(target / timeline.every);
    index = k * timeline.every;
    book = timeline.checkpoints[k] ?? EMPTY_BOOK;
  }
  for (; index < target; index++) {
    const e = timeline.events[index];
    if (e !== undefined) book = apply(book, e);
  }
  return { index, book };
}
