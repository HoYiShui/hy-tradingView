import { Millis, type CandleInterval, type MarketSymbol } from "@hy/types";
import type { ExchangeReader } from "./exchange.js";
import type { Store } from "./db.js";
import { planFetches, type Range } from "./coverage.js";

const PAGE = 200;
const PAGE_PAUSE_MS = 500;

async function pageAll<T>(fetchPage: (offset: number) => Promise<T[]>): Promise<T[]> {
  const all: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await fetchPage(offset);
    all.push(...page);
    if (page.length < PAGE) return all;
    await new Promise((r) => setTimeout(r, PAGE_PAUSE_MS));
  }
}

export async function syncFills(reader: ExchangeReader, store: Store): Promise<void> {
  const from = store.latestFillAt();
  const fills = await pageAll((offset) => reader.fetchFills({ from, limit: PAGE, offset }));
  store.saveFills(fills);
}

export async function syncFunding(reader: ExchangeReader, store: Store): Promise<void> {
  const from = store.latestFundingAt();
  const funding = await pageAll((offset) => reader.fetchFunding({ from, limit: PAGE, offset }));
  store.saveFunding(funding);
}

export async function syncPositionHistory(reader: ExchangeReader, store: Store): Promise<void> {
  const positions = await pageAll((offset) => reader.fetchPositionHistory({ limit: PAGE, offset }));
  store.savePositions(positions);
}

const FINAL = new Set(["Filled", "Cancelled", "Expired", "TriggerFailed"]);

export async function syncOrders(reader: ExchangeReader, store: Store): Promise<void> {
  for (let offset = 0; ; offset += PAGE) {
    const page = await reader.fetchOrderHistory({ limit: PAGE, offset });
    const known = store.knownOrderStatus(page.map((o) => o.id));
    store.saveOrders(page);
    const settled = page.every((o) => FINAL.has(o.status) && known.get(o.id) === o.status);
    if (page.length < PAGE || settled) return;
    await new Promise((r) => setTimeout(r, PAGE_PAUSE_MS));
  }
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
const MAX_BACKFILL_BARS = 60_000;
const MIN_REFRESH_MS = 2000;
const TAIL_BARS = 3;
const CURSOR_WAIT_MS = 25_000;

export function backfillStart(input: {
  now: number;
  step: number;
  earliestFill: number | null;
}): number {
  const floor = input.now - MAX_BACKFILL_BARS * input.step;
  const tail = input.now - CANDLES_PER_REQUEST * input.step;
  if (input.earliestFill === null) return tail;
  const wanted = Math.floor(input.earliestFill / input.step) * input.step - input.step;
  return Math.max(floor, Math.min(wanted, tail));
}

export type CandleQuery = { since: Millis | null; before: Millis | null; limit: number };

export function createCandleService(input: {
  reader: ExchangeReader;
  store: Store;
  symbol: MarketSymbol;
  now?: () => number;
  pauseMs?: number;
  log?: (msg: string) => void;
}) {
  const now = input.now ?? Date.now;
  const pauseMs = input.pauseMs ?? 500;
  const log = input.log ?? (() => undefined);
  const lastRefresh = new Map<CandleInterval, number>();
  const tail = new Map<CandleInterval, Promise<void>>();
  const backfill = new Map<CandleInterval, Promise<void>>();

  async function fetchRange(interval: CandleInterval, range: Range): Promise<void> {
    const candles = await input.reader.fetchCandles({
      symbol: input.symbol,
      interval,
      from: Millis.parse(range.from),
      to: Millis.parse(range.to),
    });
    input.store.saveCandles(input.symbol, interval, candles);
  }

  function settledEnd(interval: CandleInterval): number {
    const step = INTERVAL_MS[interval];
    return Math.floor(now() / step) * step;
  }

  function plan(interval: CandleInterval): Range[] {
    const step = INTERVAL_MS[interval];
    const from = backfillStart({ now: now(), step, earliestFill: input.store.earliestFillAt(input.symbol) });
    return planFetches({ from, to: settledEnd(interval) }, input.store.coverage(input.symbol, interval), CANDLES_PER_REQUEST * step);
  }

  async function runBackfill(interval: CandleInterval): Promise<void> {
    for (let chunks = plan(interval); chunks.length > 0; chunks = plan(interval)) {
      const next = chunks[0];
      if (next === undefined) return;
      await fetchRange(interval, next);
      input.store.addCoverage(input.symbol, interval, next);
      await new Promise((r) => setTimeout(r, pauseMs));
    }
  }

  function startBackfill(interval: CandleInterval): void {
    if (backfill.has(interval)) return;
    const run = runBackfill(interval)
      .catch((e) => log(`candle backfill ${interval} failed: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => {
        backfill.delete(interval);
      });
    backfill.set(interval, run);
  }

  async function ensureFresh(interval: CandleInterval): Promise<void> {
    const pending = tail.get(interval);
    if (pending) return pending;
    const last = lastRefresh.get(interval);
    if (last !== undefined && now() - last < MIN_REFRESH_MS) return;
    const end = now();
    const run = fetchRange(interval, { from: end - TAIL_BARS * INTERVAL_MS[interval], to: end })
      .then(() => void lastRefresh.set(interval, now()))
      .finally(() => void tail.delete(interval));
    tail.set(interval, run);
    startBackfill(interval);
    return run;
  }

  async function waitForBars(interval: CandleInterval, before: Millis | null, limit: number): Promise<void> {
    const deadline = Date.now() + CURSOR_WAIT_MS;
    const upTo = before ?? Millis.parse(now() + 1);
    const have = () => input.store.candles({ symbol: input.symbol, interval, since: null, before: upTo, limit }).length;
    while (have() < limit && backfill.has(interval) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  const refresh = (interval: CandleInterval) =>
    ensureFresh(interval).catch((e) => log(`candle refresh ${interval} failed: ${e instanceof Error ? e.message : String(e)}`));

  return {
    refresh,
    async get(interval: CandleInterval, q: CandleQuery) {
      await refresh(interval);
      if (q.since === null) await waitForBars(interval, q.before, q.limit);
      return input.store.candles({ symbol: input.symbol, interval, since: q.since, before: q.before, limit: q.limit });
    },
  };
}
