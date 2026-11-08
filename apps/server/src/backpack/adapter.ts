import { Millis } from "@hy/types";
import { buildSnapshot } from "../domain.js";
import type { ExchangeReader } from "../exchange.js";
import type { BackpackClient } from "./client.js";
import {
  parseAccountParts,
  parseCandles,
  parseFills,
  parseFunding,
  parseOpenOrders,
  parsePositionHistory,
  parsePositions,
} from "./parse.js";

const ACCOUNT_TTL_MS = 60_000;

export function createBackpackReader(client: BackpackClient, now: () => number = Date.now): ExchangeReader {
  let accountCache: { at: number; value: unknown } | null = null;

  async function account(): Promise<unknown> {
    if (accountCache && now() - accountCache.at < ACCOUNT_TTL_MS) return accountCache.value;
    const value = await client.signedGet("accountQuery", "/api/v1/account");
    accountCache = { at: now(), value };
    return value;
  }

  return {
    async fetchLive() {
      const [acc, collateral, positions, orders] = await Promise.all([
        account(),
        client.signedGet("collateralQuery", "/api/v1/capital/collateral"),
        client.signedGet("positionQuery", "/api/v1/position"),
        client.signedGet("orderQueryAll", "/api/v1/orders"),
      ]);
      return buildSnapshot({
        asOf: Millis.parse(now()),
        parts: parseAccountParts(acc, collateral),
        positions: parsePositions(positions),
        openOrders: parseOpenOrders(orders),
      });
    },
    async fetchFills({ from, limit, offset }) {
      const params = { limit, offset, ...(from === null ? {} : { from }) };
      return parseFills(await client.signedGet("fillHistoryQueryAll", "/wapi/v1/history/fills", params));
    },
    async fetchFunding({ from, limit, offset }) {
      const params = { limit, offset, ...(from === null ? {} : { from }) };
      return parseFunding(await client.signedGet("fundingHistoryQueryAll", "/wapi/v1/history/funding", params));
    },
    async fetchPositionHistory({ limit, offset }) {
      return parsePositionHistory(
        await client.signedGet("positionHistoryQueryAll", "/wapi/v1/history/position", { limit, offset }),
      );
    },
    async fetchCandles({ symbol, interval, from, to }) {
      return parseCandles(
        await client.publicGet("/api/v1/klines", { symbol, interval, startTime: Math.floor(from / 1000), endTime: Math.ceil(to / 1000) }),
      );
    },
  };
}
