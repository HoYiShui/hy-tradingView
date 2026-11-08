import { mkdirSync, writeFileSync } from "node:fs";
import { createHyperliquidClient, type InfoRequest } from "../apps/server/src/hyperliquid/client.js";
import type { ExchangeCredentials } from "../apps/server/src/config.js";

const HASHLIKE = /0x[0-9a-fA-F]{40,64}\b/g;
const redact = (body: unknown): string =>
  JSON.stringify(body).replace(HASHLIKE, (m) => `0x${"0".repeat(m.length - 2)}`);

type Probe = { name: string; request: InfoRequest; keep?: (body: unknown) => unknown };
const tail = (n: number) => (body: unknown) => (Array.isArray(body) ? body.slice(-n) : body);
const head = (n: number) => (body: unknown) => (Array.isArray(body) ? body.slice(0, n) : body);

export async function probeHyperliquid({ apiUrl, address }: Extract<ExchangeCredentials, { exchange: "hyperliquid" }>): Promise<void> {
  const client = createHyperliquidClient({ baseUrl: apiUrl });
  const dir = new URL("./samples-hyperliquid/", import.meta.url);
  mkdirSync(dir, { recursive: true });
  const now = Date.now();
  const candle = (interval: string): InfoRequest => ({ type: "candleSnapshot", req: { coin: "BTC", interval, startTime: 0, endTime: now } });
  const probes: Probe[] = [
    { name: "clearinghouseState", request: { type: "clearinghouseState", user: address } },
    { name: "spotClearinghouseState", request: { type: "spotClearinghouseState", user: address } },
    { name: "userAbstraction", request: { type: "userAbstraction", user: address } },
    { name: "frontendOpenOrders", request: { type: "frontendOpenOrders", user: address } },
    { name: "userFills", request: { type: "userFills", user: address } },
    { name: "userFillsByTime", request: { type: "userFillsByTime", user: address, startTime: 0 }, keep: head(50) },
    { name: "userFunding", request: { type: "userFunding", user: address, startTime: 0 } },
    { name: "userNonFundingLedgerUpdates", request: { type: "userNonFundingLedgerUpdates", user: address, startTime: 0 } },
    { name: "historicalOrders", request: { type: "historicalOrders", user: address }, keep: tail(300) },
    { name: "candle-15m", request: candle("15m"), keep: tail(300) },
    { name: "candle-1h", request: candle("1h"), keep: tail(300) },
    { name: "candle-4h", request: candle("4h"), keep: tail(300) },
    { name: "allMids", request: { type: "allMids" }, keep: pickKeys(["BTC", "ETH", "SOL"]) },
    { name: "portfolio", request: { type: "portfolio", user: address } },
    { name: "spotMeta", request: { type: "spotMeta" }, keep: spotHead },
    { name: "perpDexs", request: { type: "perpDexs" }, keep: head(4) },
  ];
  for (const p of probes) {
    try {
      const body = await client.info(p.request);
      writeFileSync(new URL(`${p.name}.json`, dir), redact(p.keep ? p.keep(body) : body));
      console.log(`ok   ${p.name} (${Array.isArray(body) ? `${body.length} items` : typeof body})`);
    } catch (e) {
      console.log(`fail ${p.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

function pickKeys(keys: string[]) {
  return (body: unknown) =>
    body !== null && typeof body === "object" ? Object.fromEntries(Object.entries(body).filter(([k]) => keys.includes(k))) : body;
}

function spotHead(body: unknown) {
  const meta = body as { tokens: { index: number }[]; universe: { tokens: number[] }[] };
  return { tokens: meta.tokens.slice(0, 3), universe: meta.universe.filter((u) => u.tokens.every((t) => t < 3)) };
}
