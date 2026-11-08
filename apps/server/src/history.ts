import { INTERVAL_MS, Millis, type CandleInterval, type MarketSymbol } from "@hy/types";
import type { ExchangeReader } from "./exchange.js";
import type { Store } from "./db.js";
import { planFetches, type Range } from "./coverage.js";

export async function syncFills(reader: ExchangeReader, store: Store): Promise<void> {
  store.saveFills(await reader.fetchFills({ from: store.latestFillAt() }));
}

export async function syncFunding(reader: ExchangeReader, store: Store): Promise<void> {
  store.saveFunding(await reader.fetchFunding({ from: store.latestFundingAt() }));
}

export async function syncPositionHistory(reader: ExchangeReader, store: Store): Promise<void> {
  store.savePositions(await reader.fetchPositionHistory());
}

const FINAL = new Set(["Filled", "Cancelled", "Expired", "TriggerFailed"]);

export async function syncOrders(reader: ExchangeReader, store: Store): Promise<void> {
  for await (const page of reader.orderHistory()) {
    const known = store.knownOrderStatus(page.map((o) => o.id));
    store.saveOrders(page);
    if (page.every((o) => FINAL.has(o.status) && known.get(o.id) === o.status)) return;
  }
}

const CANDLES_PER_REQUEST = 1000;
const MAX_BACKFILL_BARS = 60_000;
const TAIL_BARS = 3;
const CURSOR_WAIT_MS = 25_000;

export function backfillStart(input: {
  now: number;
  step: number;
  earliestFill: number | null;
  depthBars: number | null;
}): number {
  const floor = input.now - Math.min(MAX_BACKFILL_BARS, input.depthBars ?? Infinity) * input.step;
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
    const from = backfillStart({
      now: now(),
      step,
      earliestFill: input.store.earliestFillAt(input.symbol),
      depthBars: input.reader.capabilities.history.candleDepthBars,
    });
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
    if (last !== undefined && now() - last < input.reader.capabilities.minCandleRefreshMs) return;
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
