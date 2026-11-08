import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../apps/server/src/config.js";
import { createBackpackClient } from "../apps/server/src/backpack/client.js";

process.loadEnvFile(new URL("../.env", import.meta.url));
const config = loadConfig(process.env);
const base = process.argv[2] ?? "http://localhost:8787";
const secrets = [config.BACKPACK_API_KEY, config.BACKPACK_API_SECRET];
const failures: string[] = [];
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? "pass" : "FAIL"} ${label}`);
  if (!ok) failures.push(label);
};

const client = createBackpackClient({
  baseUrl: config.BACKPACK_API_URL,
  apiKey: config.BACKPACK_API_KEY,
  apiSecret: config.BACKPACK_API_SECRET,
});
const num = (v: unknown) => Number(v);
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

const served: string[] = [];
const get = async (path: string, init?: RequestInit) => {
  const res = await fetch(base + path, init);
  const text = await res.text();
  served.push(text, JSON.stringify([...res.headers.entries()]));
  return { res, text };
};

const feed = JSON.parse((await get("/api/feed")).text);
check(feed.kind === "live", "feed is live");
const snap = feed.snapshot;

const [collateral, positions, orders] = (await Promise.all([
  client.signedGet("collateralQuery", "/api/v1/capital/collateral"),
  client.signedGet("positionQuery", "/api/v1/position"),
  client.signedGet("orderQueryAll", "/api/v1/orders"),
])) as [Record<string, string>, Record<string, string>[], unknown[]];

check(near(snap.account.equity, num(collateral.netEquity), 0.5), `equity ${snap.account.equity.toFixed(2)} vs direct ${num(collateral.netEquity).toFixed(2)}`);
check(snap.positions.length === positions.length, `position count ${snap.positions.length} vs direct ${positions.length}`);
check(snap.openOrders.length === orders.length, `open order count ${snap.openOrders.length} vs direct ${orders.length}`);
const gross = positions.reduce((s, p) => s + Math.abs(num(p.netExposureNotional)), 0);
check(near(snap.metrics.grossNotional, gross, 1), `gross notional ${snap.metrics.grossNotional.toFixed(2)} vs direct ${gross.toFixed(2)}`);
check(near(snap.metrics.leverage, gross / num(collateral.netEquity), 0.01), `leverage ${snap.metrics.leverage.toFixed(4)}x vs direct ${(gross / num(collateral.netEquity)).toFixed(4)}x`);
const openPnl = positions.reduce((s, p) => s + num(p.pnlRealized) + num(p.pnlUnrealized), 0);
check(near(snap.metrics.openPnl, openPnl, 0.05), `open pnl ${snap.metrics.openPnl.toFixed(3)} vs direct ${openPnl.toFixed(3)}`);

const fills = JSON.parse((await get("/api/fills?limit=1000")).text);
const directFills = (await client.signedGet("fillHistoryQueryAll", "/wapi/v1/history/fills", { limit: 1000 })) as unknown[];
check(fills.length === directFills.length, `fill count ${fills.length} vs direct ${directFills.length}`);

const candles = JSON.parse((await get("/api/candles?interval=1h")).text);
const direct = (await client.publicGet("/api/v1/klines", {
  symbol: "BTC_USDC_PERP",
  interval: "1h",
  startTime: Math.floor(Date.now() / 1000) - 7200,
  endTime: Math.floor(Date.now() / 1000),
})) as Record<string, string>[];
const last = direct.at(-1) as Record<string, string>;
const served1h = candles.find((c: { start: number }) => c.start === Date.parse(`${String(last.start).replace(" ", "T")}Z`));
check(!!served1h && near(served1h.close, num(last.close), 50), `latest 1h candle close ${served1h?.close} vs direct ${last.close}`);
check(candles.length >= 900, `1h candles served: ${candles.length}`);

await get("/api/pnl/daily");
await get("/");
const html = served.at(-2) ?? "";
for (const m of html.matchAll(/(?:src|href)="(\/[^"]+)"/g)) await get(String(m[1]));

const methods = await Promise.all(["POST", "PUT", "DELETE"].map((method) => fetch(`${base}/api/feed`, { method }).then((r) => r.status)));
check(methods.every((s) => s >= 400), `mutating methods rejected: ${methods.join(",")}`);

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
const dist = walk(new URL("../apps/web/dist", import.meta.url).pathname).map((f) => readFileSync(f, "utf8"));
for (const [i, s] of secrets.entries()) {
  const name = i === 0 ? "API key" : "API secret";
  check(!served.some((t) => t.includes(s)), `${name} absent from ${served.length} served responses and headers`);
  check(!dist.some((t) => t.includes(s)), `${name} absent from ${dist.length} built bundle files`);
}

process.exit(failures.length ? 1 : 0);
