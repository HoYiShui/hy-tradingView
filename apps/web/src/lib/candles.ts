import type { Candle, CandleInterval } from "@hy/types";

export const INTERVAL_MS: Record<CandleInterval, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 3_600_000,
  "4h": 4 * 3_600_000,
  "1d": 86_400_000,
  "1w": 7 * 86_400_000,
};

export function mergeCandles(existing: readonly Candle[], incoming: readonly Candle[]): Candle[] {
  if (incoming.length === 0) return [...existing];
  const byStart = new Map<number, Candle>();
  for (const c of existing) byStart.set(c.start, c);
  for (const c of incoming) byStart.set(c.start, c);
  return [...byStart.values()].sort((a, b) => a.start - b.start);
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
  if (found === null || at >= found.start + INTERVAL_MS[interval]) return null;
  return found.start;
}
