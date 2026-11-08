import type { KeyObject } from "node:crypto";
import { privateKeyFromSeed, signMessage, signingString, type QueryParams, type ReadInstruction } from "./sign.js";

const WINDOW_MS = 10_000;

export class BackpackHttpError extends Error {
  constructor(readonly status: number, readonly path: string, body: string) {
    super(`Backpack ${path} responded ${status}: ${body.slice(0, 200)}`);
  }
}

async function fetchWithRetry(url: URL, headers: Record<string, string>): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetch(url, { method: "GET", headers, signal: AbortSignal.timeout(15_000) });
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 300 * attempt));
    }
  }
}

export interface BackpackClient {
  publicGet(path: string, params?: QueryParams): Promise<unknown>;
  signedGet(instruction: ReadInstruction, path: string, params?: QueryParams): Promise<unknown>;
}

export function createBackpackClient(config: { baseUrl: string; apiKey: string; apiSecret: string }): BackpackClient {
  const key: KeyObject = privateKeyFromSeed(config.apiSecret);

  async function get(path: string, params: QueryParams, headers: Record<string, string>): Promise<unknown> {
    const url = new URL(path, config.baseUrl);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    let res = await fetchWithRetry(url, headers);
    for (let wait = 1000; res.status === 429 && wait <= 4000; wait *= 2) {
      await new Promise((r) => setTimeout(r, wait));
      res = await fetchWithRetry(url, headers);
    }
    const text = await res.text();
    if (!res.ok) throw new BackpackHttpError(res.status, path, text);
    return JSON.parse(text);
  }

  return {
    publicGet: (path, params = {}) => get(path, params, {}),
    signedGet(instruction, path, params = {}) {
      const timestamp = Date.now();
      const message = signingString({ instruction, params, timestamp, window: WINDOW_MS });
      return get(path, params, {
        "X-API-Key": config.apiKey,
        "X-Signature": signMessage(key, message),
        "X-Timestamp": String(timestamp),
        "X-Window": String(WINDOW_MS),
      });
    },
  };
}
