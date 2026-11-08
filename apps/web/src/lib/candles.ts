import { INTERVAL_MS, type Candle, type CandleInterval } from "@hy/types";

export function mergeCandles(existing: readonly Candle[], incoming: readonly Candle[]): Candle[] {
  if (incoming.length === 0) return [...existing];
  const byStart = new Map<number, Candle>();
  for (const c of existing) byStart.set(c.start, c);
  for (const c of incoming) byStart.set(c.start, c);
  return [...byStart.values()].sort((a, b) => a.start - b.start);
}

function barEnd(start: number, interval: CandleInterval): number {
  if (interval !== "1M") return start + INTERVAL_MS[interval];
  const d = new Date(start);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

export function findCandleStart(candles: readonly Candle[], at: number, interval: CandleInterval): number | null {
  let lo = 0;
  let hi = candles.length - 1;
  let found: Candle | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = candles[mid];
    if (c === undefined) break;
    if (c.start <= at) {
      found = c;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (found === null || at >= barEnd(found.start, interval)) return null;
  return found.start;
}
