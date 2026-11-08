import { mkdirSync, writeFileSync } from "node:fs";
import type { ReadInstruction } from "../apps/server/src/backpack/sign.js";
import { createBackpackClient } from "../apps/server/src/backpack/client.js";
import type { ExchangeCredentials } from "../apps/server/src/config.js";

const REDACTED_KEYS = new Set([
  "userId", "subaccountId", "fromAddress", "toAddress", "transactionHash", "clientId", "identifier",
  "accountIdentifier", "bankIdentifier", "bankName", "platformMemo",
]);
const redact = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(redact)
    : v && typeof v === "object"
      ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, REDACTED_KEYS.has(k) ? 0 : redact(x)]))
      : v;

type Probe = { name: string; instruction?: ReadInstruction; path: string; params?: Record<string, string | number>; keep?: (body: unknown) => unknown };

const diverse = (fields: string[], cap: number) => (body: unknown) => {
  if (!Array.isArray(body)) return body;
  const seen = new Set<string>();
  const rows: unknown[] = [];
  for (const row of body) {
    const key = fields.map((f) => String((row as Record<string, unknown>)[f])).join("|");
    if (seen.has(key) || rows.length >= cap) continue;
    seen.add(key);
    rows.push(row);
  }
  return rows;
};
const probesFor = (startSec: number): Probe[] => [
  { name: "account", instruction: "accountQuery", path: "/api/v1/account" },
  { name: "collateral", instruction: "collateralQuery", path: "/api/v1/capital/collateral" },
  { name: "positions", instruction: "positionQuery", path: "/api/v1/position" },
  { name: "open-orders", instruction: "orderQueryAll", path: "/api/v1/orders" },
  { name: "order-history", instruction: "orderHistoryQueryAll", path: "/wapi/v1/history/orders", params: { limit: 100 } },
  { name: "fills", instruction: "fillHistoryQueryAll", path: "/wapi/v1/history/fills", params: { limit: 100 } },
  { name: "fills-perp", instruction: "fillHistoryQueryAll", path: "/wapi/v1/history/fills", params: { limit: 100, marketType: "PERP" } },
  { name: "funding", instruction: "fundingHistoryQueryAll", path: "/wapi/v1/history/funding", params: { limit: 100 } },
  { name: "position-history", instruction: "positionHistoryQueryAll", path: "/wapi/v1/history/position", params: { limit: 100 } },
  { name: "deposits", instruction: "depositQueryAll", path: "/wapi/v1/capital/deposits", params: { limit: 100 }, keep: diverse(["source", "symbol", "status"], 12) },
  { name: "withdrawals", instruction: "withdrawalQueryAll", path: "/wapi/v1/capital/withdrawals", params: { limit: 100 }, keep: diverse(["isInternal", "symbol", "status"], 12) },
  { name: "klines", path: "/api/v1/klines", params: { symbol: "BTC_USDC_PERP", interval: "1h", startTime: startSec } },
  { name: "mark-prices", path: "/api/v1/markPrices", params: { symbol: "BTC_USDC_PERP" } },
  { name: "ticker", path: "/api/v1/ticker", params: { symbol: "BTC_USDC_PERP" } },
  { name: "markets", path: "/api/v1/markets" },
];

export async function probeBackpack(id: string, { apiUrl, apiKey, apiSecret }: Extract<ExchangeCredentials, { exchange: "backpack" }>): Promise<void> {
  const client = createBackpackClient({ baseUrl: apiUrl, apiKey, apiSecret });
  const dir = new URL(`./samples-${id}/`, import.meta.url);
  mkdirSync(dir, { recursive: true });
  const startSec = Math.floor(Date.now() / 1000) - 3 * 3600;
  const probes = probesFor(startSec);
  for (const p of probes) {
    try {
      const body = p.instruction
        ? await client.signedGet(p.instruction, p.path, p.params)
        : await client.publicGet(p.path, p.params);
      const trimmed = p.name === "markets" && Array.isArray(body) ? body.filter((m) => /BTC/.test(String(m?.symbol))).slice(0, 6) : (p.keep?.(body) ?? body);
      writeFileSync(new URL(`${p.name}.json`, dir), JSON.stringify(redact(trimmed), null, 2));
      const n = Array.isArray(body) ? `${body.length} items` : typeof body;
      console.log(`ok   ${p.name} (${n})`);
    } catch (e) {
      console.log(`fail ${p.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
