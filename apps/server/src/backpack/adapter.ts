import { MarketSymbol, Millis, type OrderRecord } from "@hy/types";
import type { ExchangeCapabilities, ExchangeReader } from "../exchange.js";
import type { BackpackClient } from "./client.js";
import { buildSnapshot } from "./snapshot.js";
import {
  parseAccountParts,
  parseCandles,
  parseDeposits,
  parseWithdrawals,
  parseFills,
  parseFunding,
  parseOpenOrders,
  parseOrderHistory,
  parsePositionHistory,
  parsePositions,
} from "./parse.js";

const ACCOUNT_TTL_MS = 60_000;
const CHART_SYMBOL = MarketSymbol.parse("BTC_USDC_PERP");
const PAGE = 200;
const PAGE_PAUSE_MS = 500;

export const BACKPACK_CAPABILITIES: ExchangeCapabilities = {
  intervals: ["1m", "5m", "15m", "1h", "4h", "1d", "1w"],
  history: { candleDepthBars: null, fillDepth: null },
  minLivePollMs: 2_000,
  minSyncMs: 5_000,
  minCandleRefreshMs: 2_000,
};

function rows(body: unknown): unknown[] {
  if (!Array.isArray(body)) throw new Error("expected a list response");
  return body;
}

async function pageAll<T>(fetchPage: (offset: number) => Promise<T[]>): Promise<T[]> {
  const all: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await fetchPage(offset);
    all.push(...page);
    if (page.length < PAGE) return all;
    await new Promise((r) => setTimeout(r, PAGE_PAUSE_MS));
  }
}

export function createBackpackReader(client: BackpackClient, now: () => number = Date.now): ExchangeReader {
  let accountCache: { at: number; value: unknown } | null = null;

  async function account(): Promise<unknown> {
    if (accountCache && now() - accountCache.at < ACCOUNT_TTL_MS) return accountCache.value;
    const value = await client.signedGet("accountQuery", "/api/v1/account");
    accountCache = { at: now(), value };
    return value;
  }

  return {
    exchange: "backpack",
    chartSymbol: CHART_SYMBOL,
    capabilities: BACKPACK_CAPABILITIES,
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
    async fetchFills({ from }) {
      const fills = await pageAll(async (offset) => {
        const params = { limit: PAGE, offset, ...(from === null ? {} : { from }) };
        return parseFills(await client.signedGet("fillHistoryQueryAll", "/wapi/v1/history/fills", params));
      });
      return fills.sort((a, b) => a.at - b.at || Number(a.id) - Number(b.id));
    },
    fetchFunding({ from }) {
      return pageAll(async (offset) => {
        const params = { limit: PAGE, offset, ...(from === null ? {} : { from }) };
        return parseFunding(await client.signedGet("fundingHistoryQueryAll", "/wapi/v1/history/funding", params));
      });
    },
    fetchPositionHistory() {
      return pageAll(async (offset) =>
        parsePositionHistory(await client.signedGet("positionHistoryQueryAll", "/wapi/v1/history/position", { limit: PAGE, offset })),
      );
    },
    async fetchTransfers({ from }) {
      const params = (offset: number) => ({ limit: PAGE, offset, ...(from === null ? {} : { from }) });
      const deposits = await pageAll(async (offset) =>
        rows(await client.signedGet("depositQueryAll", "/wapi/v1/capital/deposits", params(offset))),
      );
      const withdrawals = await pageAll(async (offset) =>
        rows(await client.signedGet("withdrawalQueryAll", "/wapi/v1/capital/withdrawals", params(offset))),
      );
      return [...parseDeposits(deposits), ...parseWithdrawals(withdrawals)];
    },
    async *orderHistory(): AsyncGenerator<OrderRecord[]> {
      for (let offset = 0; ; offset += PAGE) {
        const page = parseOrderHistory(
          await client.signedGet("orderHistoryQueryAll", "/wapi/v1/history/orders", { limit: PAGE, offset }),
        );
        yield page;
        if (page.length < PAGE) return;
        await new Promise((r) => setTimeout(r, PAGE_PAUSE_MS));
      }
    },
    async fetchCandles({ symbol, interval, from, to }) {
      return parseCandles(
        await client.publicGet("/api/v1/klines", { symbol, interval, startTime: Math.floor(from / 1000), endTime: Math.ceil(to / 1000) }),
      );
    },
  };
}
