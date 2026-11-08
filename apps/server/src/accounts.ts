import { resolve } from "node:path";
import type { AccountInfo, Surface } from "@hy/types";
import { hasSurface, type AccountConfig } from "./config.js";
import { equityBucket, openStore, type Store } from "./db.js";
import { repoRoot } from "./env.js";
import type { ExchangeCapabilities, ExchangeReader } from "./exchange.js";
import { createReader } from "./exchanges.js";
import { createFeed } from "./feed.js";
import { createCandleService, syncFills, syncFunding, syncOrders, syncPositionHistory } from "./history.js";

export type AccountContext = {
  info: AccountInfo;
  reader: ExchangeReader;
  store: Store;
  feed: ReturnType<typeof createFeed>;
  candles: ReturnType<typeof createCandleService>;
};

export type ServedAccount = Pick<AccountContext, "info" | "store" | "feed" | "candles">;

export type Registry = readonly ServedAccount[];

export function resolveAccount(registry: Registry, surface: Surface, id: string | undefined): ServedAccount | null {
  const onSurface = registry.filter((a) => a.info.surfaces.includes(surface));
  return id === undefined ? (onSurface[0] ?? null) : (onSurface.find((a) => a.info.id === id) ?? null);
}

type Job = { name: string; everyMs: number; run: (ctx: AccountContext) => Promise<void> };
type Pacing = Pick<ExchangeCapabilities, "minLivePollMs" | "minSyncMs">;

const fills: Job = { name: "fill sync", everyMs: 5_000, run: (c) => syncFills(c.reader, c.store) };
const funding: Job = { name: "funding sync", everyMs: 60_000, run: (c) => syncFunding(c.reader, c.store) };
const positions: Job = { name: "position sync", everyMs: 60_000, run: (c) => syncPositionHistory(c.reader, c.store) };
const orders: Job = { name: "order sync", everyMs: 60_000, run: (c) => syncOrders(c.reader, c.store) };

const SURFACE_JOBS: Record<Surface, Job[]> = {
  dashboard: [fills, funding, positions],
  replay: [fills, funding, orders],
};

const DASHBOARD_POLL_MS = 2_000;
const ANCHOR_POLL_MS = 30_000;

export type Plan = { pollMs: number; recordEquity: boolean; jobs: Job[] };

export function planFor(surfaces: readonly Surface[], pacing: Pacing): Plan {
  const dashboard = hasSurface({ surfaces }, "dashboard");
  return {
    pollMs: Math.max(dashboard ? DASHBOARD_POLL_MS : ANCHOR_POLL_MS, pacing.minLivePollMs),
    recordEquity: dashboard,
    jobs: [...new Set(surfaces.flatMap((s) => SURFACE_JOBS[s]))].map((j) => ({ ...j, everyMs: Math.max(j.everyMs, pacing.minSyncMs) })),
  };
}

export type RegistryDeps = {
  readerFor: (account: AccountConfig) => ExchangeReader;
  storeFor: (account: AccountConfig) => Store;
  log: (msg: string) => void;
};

export const defaultDeps = (log: (msg: string) => void): RegistryDeps => ({
  readerFor: createReader,
  storeFor: (a) => openStore(resolve(repoRoot, a.dbPath)),
  log,
});

export function createAccountContext(account: AccountConfig, deps: RegistryDeps): AccountContext {
  const reader = deps.readerFor(account);
  const store = deps.storeFor(account);
  const log = (msg: string) => deps.log(`${account.id}: ${msg}`);
  return {
    info: {
      id: account.id,
      label: account.label,
      exchange: reader.exchange,
      surfaces: account.surfaces,
      chartSymbol: reader.chartSymbol,
      intervals: [...reader.capabilities.intervals],
      history: reader.capabilities.history,
    },
    reader,
    store,
    feed: createFeed(reader, { pollMs: planFor(account.surfaces, reader.capabilities).pollMs, log }),
    candles: createCandleService({ reader, store, symbol: reader.chartSymbol, log }),
  };
}

function every(ms: number, name: string, log: (msg: string) => void, work: () => Promise<void>): void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await work();
    } catch (e) {
      log(`${name} failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      running = false;
    }
  };
  void run();
  setInterval(run, ms).unref();
}

export function startAccount(ctx: AccountContext, log: (msg: string) => void): void {
  const plan = planFor(ctx.info.surfaces, ctx.reader.capabilities);
  for (const job of plan.jobs) every(job.everyMs, `${ctx.info.id} ${job.name}`, log, () => job.run(ctx));
  if (plan.recordEquity) {
    let last = -1;
    ctx.feed.subscribe((f) => {
      if (f.kind !== "live") return;
      const bucket = equityBucket(f.snapshot.asOf);
      if (bucket === last) return;
      last = bucket;
      ctx.store.saveEquity({
        ts: f.snapshot.asOf,
        equity: f.snapshot.account.equity,
        openPnl: f.snapshot.metrics.openPnl,
        notional: f.snapshot.metrics.grossNotional,
      });
    });
  }
  ctx.feed.start();
}
