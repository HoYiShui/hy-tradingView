import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { AccountList, API, type AccountInfo } from "../packages/types/src/index.js";
import { hasSurface } from "../apps/server/src/config.js";
import { loadAccount } from "./account.js";

const { config, account, client } = loadAccount(process.argv[2]);
const base = process.argv[3] ?? `http://localhost:${config.port}`;
const secrets = config.accounts.flatMap((a) => [a.credentials.apiKey, a.credentials.apiSecret]);
console.log(`account: ${account.id} (${account.surfaces.join(", ")}) against ${base}`);
const failures: string[] = [];
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? "pass" : "FAIL"} ${label}`);
  if (!ok) failures.push(label);
};

const num = (v: unknown) => Number(v);
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

const served: string[] = [];
const get = async (path: string, init?: RequestInit) => {
  const res = await fetch(base + path, init);
  const text = await res.text();
  served.push(text, JSON.stringify([...res.headers.entries()]));
  return { res, text };
};

const listed = AccountList.parse(JSON.parse((await get(API.accounts)).text));
const info = listed.find((a: AccountInfo) => a.id === account.id);
check(info !== undefined && info.surfaces.join() === account.surfaces.join(), `${API.accounts} lists ${account.id} with its surfaces`);
const chartSymbol = info?.chartSymbol ?? "";

const collateral = (await client.signedGet("collateralQuery", "/api/v1/capital/collateral")) as Record<string, string>;
const directFills = (await client.signedGet("fillHistoryQueryAll", "/wapi/v1/history/fills", { limit: 1000 })) as unknown[];

if (hasSurface(account, "dashboard")) {
  const feed = JSON.parse((await get(API.account(account.id, "snapshot"))).text);
  check(feed.kind === "live", "feed is live");
  const snap = feed.snapshot;

  const [positions, orders] = (await Promise.all([
    client.signedGet("positionQuery", "/api/v1/position"),
    client.signedGet("orderQueryAll", "/api/v1/orders"),
  ])) as [Record<string, string>[], unknown[]];

  check(near(snap.account.equity, num(collateral.netEquity), 0.5), `equity ${snap.account.equity.toFixed(2)} vs direct ${num(collateral.netEquity).toFixed(2)}`);
  check(snap.positions.length === positions.length, `position count ${snap.positions.length} vs direct ${positions.length}`);
  check(snap.openOrders.length === orders.length, `open order count ${snap.openOrders.length} vs direct ${orders.length}`);
  const gross = positions.reduce((s, p) => s + Math.abs(num(p.netExposureNotional)), 0);
  check(near(snap.metrics.grossNotional, gross, 1), `gross notional ${snap.metrics.grossNotional.toFixed(2)} vs direct ${gross.toFixed(2)}`);
  check(near(snap.metrics.leverage, gross / num(collateral.netEquity), 0.01), `leverage ${snap.metrics.leverage.toFixed(4)}x vs direct ${(gross / num(collateral.netEquity)).toFixed(4)}x`);
  const openPnl = positions.reduce((s, p) => s + num(p.pnlRealized) + num(p.pnlUnrealized), 0);
  check(near(snap.metrics.openPnl, openPnl, 0.05), `open pnl ${snap.metrics.openPnl.toFixed(3)} vs direct ${openPnl.toFixed(3)}`);

  const fills = JSON.parse((await get(`${API.account(account.id, "fills")}?limit=1000`)).text);
  check(fills.length === directFills.length, `fill count ${fills.length} vs direct ${directFills.length}`);

  const candles = JSON.parse((await get(`${API.account(account.id, "candles")}?interval=1h&limit=1000`)).text);
  const direct = (await client.publicGet("/api/v1/klines", {
    symbol: chartSymbol,
    interval: "1h",
    startTime: Math.floor(Date.now() / 1000) - 7200,
    endTime: Math.floor(Date.now() / 1000),
  })) as Record<string, string>[];
  const last = direct.at(-1) as Record<string, string>;
  const served1h = candles.find((c: { start: number }) => c.start === Date.parse(`${String(last.start).replace(" ", "T")}Z`));
  check(!!served1h && near(served1h.close, num(last.close), 50), `latest 1h candle close ${served1h?.close} vs direct ${last.close}`);
  check(candles.length >= 900, `1h candles served: ${candles.length}`);
  await get(API.account(account.id, "dailyPnl"));
  await get(`${API.account(account.id, "equity")}?range=7d`);
  await get("/");
  const html = served.at(-2) ?? "";
  for (const m of html.matchAll(/(?:src|href)="(\/[^"]+)"/g)) await get(String(m[1]));
} else {
  const status = (await get(API.account(account.id, "snapshot"))).res.status;
  check(status === 404, `dashboard routes are 404 for a replay-only account: ${status}`);
}

if (hasSurface(account, "replay")) {
  const replay = JSON.parse((await get(`${API.replay}?account=${account.id}&interval=1h`)).text);
  check(near(replay.anchor.equity, num(collateral.netEquity), 0.5), `replay anchor equity ${replay.anchor.equity.toFixed(2)} vs direct ${num(collateral.netEquity).toFixed(2)}`);
  check(replay.fills.length >= directFills.length, `replay fills ${replay.fills.length} cover direct page ${directFills.length}`);
  check(replay.candles.length > 0, `replay candles ${replay.candles.length}`);
  check(replay.symbol === chartSymbol, `replay symbol ${replay.symbol} is the adapter chart market`);
} else {
  const status = (await get(`${API.replay}?account=${account.id}`)).res.status;
  check(status === 404, `replay route is 404 for a dashboard-only account: ${status}`);
}

const methods = await Promise.all(
  ["POST", "PUT", "DELETE"].map((method) => fetch(`${base}${API.account(account.id, "snapshot")}`, { method }).then((r) => r.status)),
);
check(methods.every((s) => s >= 400), `mutating methods rejected: ${methods.join(",")}`);

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
const dist = walk(new URL("../apps/web/dist", import.meta.url).pathname).map((f) => readFileSync(f, "utf8"));
check(!served.some((t) => secrets.some((s) => t.includes(s))), `no account key or secret in ${served.length} served responses and headers`);
check(!dist.some((t) => secrets.some((s) => t.includes(s))), `no account key or secret in ${dist.length} built bundle files`);

process.exit(failures.length ? 1 : 0);
