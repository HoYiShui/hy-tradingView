import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import { serve } from "@hono/node-server";
import { CHART_SYMBOL } from "@hy/types";
import { createApp } from "./app.js";
import { createBackpackReader } from "./backpack/adapter.js";
import { createBackpackClient } from "./backpack/client.js";
import { loadConfig } from "./config.js";
import { loadRootEnv, repoRoot } from "./env.js";
import { equityBucket, openStore } from "./db.js";
import { createFeed } from "./feed.js";
import { createCandleService, syncFills, syncSlowHistory } from "./history.js";

loadRootEnv();

let config;
try {
  config = loadConfig(process.env);
} catch (e) {
  console.error(e instanceof Error ? e.message : "Invalid configuration");
  process.exit(1);
}

const log = (msg: string) => console.error(`[${new Date().toISOString()}] ${msg}`);

const reader = createBackpackReader(
  createBackpackClient({ baseUrl: config.BACKPACK_API_URL, apiKey: config.BACKPACK_API_KEY, apiSecret: config.BACKPACK_API_SECRET }),
);
const store = openStore(resolve(repoRoot, config.DB_PATH));
const feed = createFeed(reader, { pollMs: 2000, log });
const candles = createCandleService({ reader, store, symbol: CHART_SYMBOL, log });

function every(ms: number, name: string, work: () => Promise<void>): void {
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

every(5_000, "fill sync", () => syncFills(reader, store));
every(60_000, "history sync", () => syncSlowHistory(reader, store));
let lastEquityBucket = -1;
feed.subscribe((f) => {
  if (f.kind !== "live") return;
  const bucket = equityBucket(f.snapshot.asOf);
  if (bucket === lastEquityBucket) return;
  lastEquityBucket = bucket;
  store.saveEquity({
    ts: f.snapshot.asOf,
    equity: f.snapshot.account.equity,
    openPnl: f.snapshot.metrics.openPnl,
    notional: f.snapshot.metrics.grossNotional,
  });
});
feed.start();

const webDist = resolve(repoRoot, "apps/web/dist");
const app = createApp({ feed, candles, store, webRoot: existsSync(webDist) ? relative(process.cwd(), webDist) || "." : null });
serve({ fetch: app.fetch, port: config.PORT }, (info) => log(`listening on :${info.port}`));
