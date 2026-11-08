import { createBackpackClient } from "../../apps/server/src/backpack/client.js";
import type { ExchangeCredentials } from "../../apps/server/src/config.js";
import type { Direct } from "./types.js";

type Backpack = Extract<ExchangeCredentials, { exchange: "backpack" }>;

export function directBackpack({ apiUrl, apiKey, apiSecret }: Backpack): Direct {
  const client = createBackpackClient({ baseUrl: apiUrl, apiKey, apiSecret });
  return {
    secrets: [apiKey, apiSecret],
    async equity() {
      const collateral = (await client.signedGet("collateralQuery", "/api/v1/capital/collateral")) as Record<string, string>;
      return Number(collateral["netEquity"]);
    },
    async positions() {
      const rows = (await client.signedGet("positionQuery", "/api/v1/position")) as Record<string, string>[];
      return rows.map((p) => ({
        symbol: String(p["symbol"]),
        quantity: Number(p["netQuantity"]),
        entryPrice: Number(p["entryPrice"]),
        markPrice: Number(p["markPrice"]),
        notional: Math.abs(Number(p["netExposureNotional"])),
        openPnl: Number(p["pnlRealized"]) + Number(p["pnlUnrealized"]),
      }));
    },
    async openOrderCount() {
      return ((await client.signedGet("orderQueryAll", "/api/v1/orders")) as unknown[]).length;
    },
    async fillCount(limit) {
      return ((await client.signedGet("fillHistoryQueryAll", "/wapi/v1/history/fills", { limit })) as unknown[]).length;
    },
    async latestCandle(symbol, interval) {
      const now = Math.floor(Date.now() / 1000);
      const rows = (await client.publicGet("/api/v1/klines", { symbol, interval, startTime: now - 7200, endTime: now })) as Record<string, string>[];
      const last = rows.at(-1);
      if (last === undefined) throw new Error("no direct candle");
      return { start: Date.parse(`${String(last["start"]).replace(" ", "T")}Z`), close: Number(last["close"]) };
    },
  };
}
