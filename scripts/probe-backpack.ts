import { mkdirSync, writeFileSync } from "node:fs";
import { loadConfig } from "../apps/server/src/config.js";
import { loadRootEnv } from "../apps/server/src/env.js";
import { createBackpackClient } from "../apps/server/src/backpack/client.js";
import type { ReadInstruction } from "../apps/server/src/backpack/sign.js";

const { account } = loadRootEnv();
const config = loadConfig(process.env);
const client = createBackpackClient({
  baseUrl: config.BACKPACK_API_URL,
  apiKey: config.BACKPACK_API_KEY,
  apiSecret: config.BACKPACK_API_SECRET,
});

const dir = new URL(account === "test" ? "./samples-test/" : "./samples/", import.meta.url);
mkdirSync(dir, { recursive: true });

const REDACTED_KEYS = new Set(["userId", "subaccountId"]);
const redact = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(redact)
    : v && typeof v === "object"
      ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, REDACTED_KEYS.has(k) ? 0 : redact(x)]))
      : v;

type Probe = { name: string; instruction?: ReadInstruction; path: string; params?: Record<string, string | number> };
const startSec = Math.floor(Date.now() / 1000) - 3 * 3600;
const probes: Probe[] = [
  { name: "account", instruction: "accountQuery", path: "/api/v1/account" },
  { name: "collateral", instruction: "collateralQuery", path: "/api/v1/capital/collateral" },
  { name: "positions", instruction: "positionQuery", path: "/api/v1/position" },
  { name: "open-orders", instruction: "orderQueryAll", path: "/api/v1/orders" },
  { name: "order-history", instruction: "orderHistoryQueryAll", path: "/wapi/v1/history/orders", params: { limit: 100 } },
  { name: "fills", instruction: "fillHistoryQueryAll", path: "/wapi/v1/history/fills", params: { limit: 100 } },
  { name: "fills-perp", instruction: "fillHistoryQueryAll", path: "/wapi/v1/history/fills", params: { limit: 100, marketType: "PERP" } },
  { name: "funding", instruction: "fundingHistoryQueryAll", path: "/wapi/v1/history/funding", params: { limit: 100 } },
  { name: "position-history", instruction: "positionHistoryQueryAll", path: "/wapi/v1/history/position", params: { limit: 100 } },
  { name: "klines", path: "/api/v1/klines", params: { symbol: "BTC_USDC_PERP", interval: "1h", startTime: startSec } },
  { name: "mark-prices", path: "/api/v1/markPrices", params: { symbol: "BTC_USDC_PERP" } },
  { name: "ticker", path: "/api/v1/ticker", params: { symbol: "BTC_USDC_PERP" } },
  { name: "markets", path: "/api/v1/markets" },
];

for (const p of probes) {
  try {
    const body = p.instruction
      ? await client.signedGet(p.instruction, p.path, p.params)
      : await client.publicGet(p.path, p.params);
    const trimmed = p.name === "markets" && Array.isArray(body) ? body.filter((m) => /BTC/.test(String(m?.symbol))).slice(0, 6) : body;
    writeFileSync(new URL(`${p.name}.json`, dir), JSON.stringify(redact(trimmed), null, 2));
    const n = Array.isArray(body) ? `${body.length} items` : typeof body;
    console.log(`ok   ${p.name} (${n})`);
  } catch (e) {
    console.log(`fail ${p.name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
