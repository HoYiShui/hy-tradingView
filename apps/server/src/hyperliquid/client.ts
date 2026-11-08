import type { Address } from "./address.js";

export type InfoRequest =
  | { type: "clearinghouseState"; user: Address; dex?: string }
  | { type: "spotClearinghouseState"; user: Address }
  | { type: "userAbstraction"; user: Address }
  | { type: "frontendOpenOrders"; user: Address; dex?: string }
  | { type: "userFills"; user: Address }
  | { type: "userFillsByTime"; user: Address; startTime: number }
  | { type: "userFunding"; user: Address; startTime: number }
  | { type: "userNonFundingLedgerUpdates"; user: Address; startTime: number }
  | { type: "historicalOrders"; user: Address }
  | { type: "portfolio"; user: Address }
  | { type: "candleSnapshot"; req: { coin: string; interval: string; startTime: number; endTime: number } }
  | { type: "allMids"; dex?: string }
  | { type: "perpDexs" }
  | { type: "spotMeta" }
  | { type: "meta"; dex?: string }
  | { type: "metaAndAssetCtxs"; dex?: string };

export class HyperliquidHttpError extends Error {
  constructor(readonly status: number, readonly request: string, body: string) {
    super(`Hyperliquid ${request} responded ${status}: ${body.slice(0, 200)}`);
  }
}

export interface HyperliquidClient {
  info(request: InfoRequest): Promise<unknown>;
}

const ATTEMPTS = 5;
const TIMEOUT_MS = 15_000;
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createHyperliquidClient(config: { baseUrl: string; sleepMs?: (ms: number) => Promise<void> }): HyperliquidClient {
  const url = new URL("/info", config.baseUrl);
  const wait = config.sleepMs ?? sleep;

  return {
    async info(request) {
      for (let attempt = 1; ; attempt++) {
        try {
          const res = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(request),
            signal: AbortSignal.timeout(TIMEOUT_MS),
          });
          const text = await res.text();
          if (res.ok) return JSON.parse(text);
          if (!RETRYABLE.has(res.status) || attempt >= ATTEMPTS) throw new HyperliquidHttpError(res.status, request.type, text);
        } catch (e) {
          if (e instanceof HyperliquidHttpError || attempt >= ATTEMPTS) throw e;
        }
        await wait(500 * 2 ** (attempt - 1));
      }
    },
  };
}
