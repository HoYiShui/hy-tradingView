import { Millis, type CandleInterval, type MarketSymbol } from "@hy/types";
import type { ExchangeReader } from "./exchange.js";
import type { Store } from "./db.js";

const PAGE = 200;

async function pageAll<T>(fetchPage: (offset: number) => Promise<T[]>): Promise<T[]> {
  const all: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await fetchPage(offset);
    all.push(...page);
    if (page.length < PAGE) return all;
  }
}

export async function syncFills(reader: ExchangeReader, store: Store): Promise<void> {
  const from = store.latestFillAt();
  const fills = await pageAll((offset) => reader.fetchFills({ from, limit: PAGE, offset }));
  store.saveFills(fills);
}

export async function syncSlowHistory(reader: ExchangeReader, store: Store): Promise<void> {
  const fromFunding = store.latestFundingAt();
  const funding = await pageAll((offset) => reader.fetchFunding({ from: fromFunding, limit: PAGE, offset }));
  store.saveFunding(funding);
  const positions = await pageAll((offset) => reader.fetchPositionHistory({ limit: PAGE, offset }));
  store.savePositions(positions);
}

export const INTERVAL_MS: Record<CandleInterval, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 3_600_000,
  "4h": 4 * 3_600_000,
  "1d": 86_400_000,
  "1w": 7 * 86_400_000,
};

const CANDLES_PER_REQUEST = 1000;
const MIN_REFRESH_MS = 2000;

export function createCandleService(input: {
  reader: ExchangeReader;
  store: Store;
  symbol: MarketSymbol;
  now?: () => number;
}) {
  const now = input.now ?? Date.now;
  const lastRefresh = new Map<CandleInterval, number>();
  const inflight = new Map<CandleInterval, Promise<void>>();

  async function refresh(interval: CandleInterval): Promise<void> {
    const step = INTERVAL_MS[interval];
    const end = now();
    const latest = input.store.latestCandleStart(input.symbol, interval);
    let from = latest ?? end - CANDLES_PER_REQUEST * step;
    while (from <= end) {
      const to = Math.min(end, from + CANDLES_PER_REQUEST * step);
      const candles = await input.reader.fetchCandles({
        symbol: input.symbol,
        interval,
        from: Millis.parse(from),
        to: Millis.parse(to),
      });
      input.store.saveCandles(input.symbol, interval, candles);
      from = to + 1;
    }
  }

  async function ensureFresh(interval: CandleInterval): Promise<void> {
    const pending = inflight.get(interval);
    if (pending) return pending;
    const last = lastRefresh.get(interval);
    if (last !== undefined && now() - last < MIN_REFRESH_MS) return;
    const run = refresh(interval)
      .then(() => void lastRefresh.set(interval, now()))
      .finally(() => void inflight.delete(interval));
    inflight.set(interval, run);
    return run;
  }

  return {
    async get(interval: CandleInterval, since: Millis | null) {
      await ensureFresh(interval).catch(() => undefined);
      return input.store.candles({ symbol: input.symbol, interval, since, limit: 1000 });
    },
  };
}
