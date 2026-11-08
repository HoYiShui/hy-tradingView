import { MarketSymbol, Millis, type OrderRecord } from "@hy/types";
import type { ExchangeCapabilities, ExchangeReader, FundingPayment } from "../exchange.js";
import type { Address } from "./address.js";
import type { HyperliquidClient } from "./client.js";
import {
  dexOf,
  parseAbstraction,
  parseCandles,
  parseFills,
  parseFunding,
  parseMids,
  parseOpenOrders,
  parseOrderHistory,
  parsePerpDexNames,
  parsePerpState,
  parseSpotPricing,
  parseSpotState,
  STABLE_TOKENS,
  type AccountMode,
  type SpotPricing,
} from "./parse.js";
import { buildSnapshot, type UsdPerUnit } from "./snapshot.js";

const CHART_SYMBOL = MarketSymbol.parse("BTC");
const MODE_TTL_MS = 5 * 60_000;
const DEX_SCAN_MS = 10 * 60_000;
const PRICING_TTL_MS = 60 * 60_000;
const TIME_RANGE_PAGE = 500;
const PAGE_PAUSE_MS = 500;

export const HYPERLIQUID_CAPABILITIES: ExchangeCapabilities = {
  intervals: ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "8h", "12h", "1d", "3d", "1w", "1M"],
  history: { candleDepthBars: 5000, fillDepth: 10_000 },
  minLivePollMs: 15_000,
  minSyncMs: 15_000,
  minCandleRefreshMs: 10_000,
};

function firstOfEach<T>(items: readonly T[], key: (item: T) => string): T[] {
  return [...new Map(items.map((i) => [key(i), i] as const).reverse()).values()].reverse();
}

type Cached<T> = { at: number; value: T };

export function createHyperliquidReader(input: {
  client: HyperliquidClient;
  address: Address;
  now?: () => number;
  pauseMs?: number;
}): ExchangeReader {
  const { client, address } = input;
  const now = input.now ?? Date.now;
  const pauseMs = input.pauseMs ?? PAGE_PAUSE_MS;
  const user = address;

  let mode: Cached<AccountMode> | null = null;
  let pricing: Cached<SpotPricing> | null = null;
  let dexNames: Cached<string[]> | null = null;
  let activeDexs: { scannedAt: number; names: Set<string> } | null = null;
  const tradedDexs = new Set<string>();

  const fresh = <T>(c: Cached<T> | null, ttl: number): c is Cached<T> => c !== null && now() - c.at < ttl;

  async function accountMode(): Promise<AccountMode> {
    if (fresh(mode, MODE_TTL_MS)) return mode.value;
    const value = parseAbstraction(await client.info({ type: "userAbstraction", user }));
    mode = { at: now(), value };
    return value;
  }

  async function perpDexNames(): Promise<string[]> {
    if (fresh(dexNames, DEX_SCAN_MS)) return dexNames.value;
    const value = parsePerpDexNames(await client.info({ type: "perpDexs" }));
    dexNames = { at: now(), value };
    return value;
  }

  async function dexesToRead(): Promise<{ names: string[]; scan: boolean }> {
    const scan = activeDexs === null || now() - activeDexs.scannedAt >= DEX_SCAN_MS;
    if (scan) return { names: ["", ...(await perpDexNames())], scan };
    return { names: ["", ...new Set([...(activeDexs?.names ?? []), ...tradedDexs])], scan };
  }

  async function readDex(dex: string) {
    const scope = dex === "" ? {} : { dex };
    const [state, orders] = await Promise.all([
      client.info({ type: "clearinghouseState", user, ...scope }),
      client.info({ type: "frontendOpenOrders", user, ...scope }),
    ]);
    return { dex, perp: parsePerpState(state), orders: parseOpenOrders(orders) };
  }

  async function usdPerUnit(balances: readonly { coin: string; token: number; total: number }[]): Promise<UsdPerUnit> {
    const priced = balances.filter((b) => b.total > 0 && !STABLE_TOKENS.has(b.coin));
    if (priced.length === 0) return (b) => (STABLE_TOKENS.has(b.coin) ? 1 : 0);
    if (!fresh(pricing, PRICING_TTL_MS)) pricing = { at: now(), value: parseSpotPricing(await client.info({ type: "spotMeta" })) };
    const meta = pricing.value;
    const mids = parseMids(await client.info({ type: "allMids" }));
    return (b) => {
      if (STABLE_TOKENS.has(b.coin)) return 1;
      const pair = meta.pairNameByBase.get(b.token);
      const mid = pair === undefined ? undefined : mids[pair];
      if (mid === undefined) {
        if (b.total === 0) return 0;
        throw new Error(`spot token ${b.coin} has no stable-quoted market to value it`);
      }
      return mid;
    };
  }

  async function pagedByTime<T extends { time: number }>(
    from: number,
    request: (startTime: number) => Promise<T[]>,
  ): Promise<T[]> {
    const all: T[] = [];
    let start = from;
    for (;;) {
      const page = await request(start);
      all.push(...page);
      const last = page.at(-1);
      if (page.length < TIME_RANGE_PAGE || last === undefined || last.time <= start) return all;
      start = last.time;
      await new Promise((r) => setTimeout(r, pauseMs));
    }
  }

  return {
    exchange: "hyperliquid",
    chartSymbol: CHART_SYMBOL,
    capabilities: HYPERLIQUID_CAPABILITIES,
    async fetchLive() {
      const { names, scan } = await dexesToRead();
      const [accountModeNow, spotRaw, dexStates] = await Promise.all([
        accountMode(),
        client.info({ type: "spotClearinghouseState", user }),
        Promise.all(names.map(readDex)),
      ]);
      if (scan) {
        activeDexs = {
          scannedAt: now(),
          names: new Set(dexStates.filter((d) => d.dex !== "" && (d.perp.positions.length > 0 || d.orders.length > 0)).map((d) => d.dex)),
        };
      }
      const spot = parseSpotState(spotRaw);
      return buildSnapshot({
        asOf: Millis.parse(now()),
        mode: accountModeNow,
        perps: dexStates.map((d) => d.perp),
        spot,
        usdPerUnit: await usdPerUnit(spot.balances),
        openOrders: dexStates.flatMap((d) => d.orders),
      });
    },
    async fetchFills({ from }) {
      const raw = await pagedByTime(from ?? 0, async (startTime) => (await client.info({ type: "userFillsByTime", user, startTime })) as { time: number }[]);
      const fills = firstOfEach(parseFills(raw), (f) => f.id);
      for (const f of fills) tradedDexs.add(dexOf(f.symbol));
      tradedDexs.delete("");
      return fills;
    },
    async fetchFunding({ from }) {
      const raw = await pagedByTime(from ?? 0, async (startTime) => (await client.info({ type: "userFunding", user, startTime })) as { time: number }[]);
      return firstOfEach<FundingPayment>(parseFunding(raw), (p) => `${p.symbol}:${p.at}`);
    },
    async fetchPositionHistory() {
      return [];
    },
    async *orderHistory(): AsyncGenerator<OrderRecord[]> {
      yield parseOrderHistory(await client.info({ type: "historicalOrders", user }));
    },
    async fetchCandles({ symbol, interval, from, to }) {
      const raw = await client.info({ type: "candleSnapshot", req: { coin: symbol, interval, startTime: from, endTime: to } });
      return parseCandles(raw).sort((a, b) => a.start - b.start);
    },
  };
}
