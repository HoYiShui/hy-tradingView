import { z } from "zod";
import { Candle, Fill, MarketSymbol, Millis, OrderRecord, OpenOrder, Position, Price, Qty, Usd, type OrderStatus } from "@hy/types";
import type { FundingPayment } from "../exchange.js";
import {
  RawAbstraction,
  RawCandle,
  RawClearinghouse,
  RawFill,
  RawFunding,
  RawHistoricalOrder,
  RawMids,
  RawOpenOrder,
  RawPerpDexs,
  RawSpotMeta,
  RawSpotState,
} from "./raw.js";

export const STABLE_TOKENS: ReadonlySet<string> = new Set(["USDC", "USDT0", "USDH", "USDE"]);

export type AccountMode = "pooled" | "perp";

export type PerpState = {
  positions: Position[];
  accountValue: number;
  withdrawable: number;
  totalNotional: number;
  totalMarginUsed: number;
  crossMaintenanceMargin: number;
  crossNotional: number;
  maxLeverage: number | null;
};

export type SpotBalance = { coin: string; token: number; total: number; hold: number };
export type SpotState = { balances: SpotBalance[]; availableAfterMaintenance: ReadonlyMap<number, number> };

export type SpotPricing = { tokenNames: ReadonlyMap<number, string>; pairNameByBase: ReadonlyMap<number, string> };

const sideOf = (s: "B" | "A") => (s === "B" ? ("buy" as const) : ("sell" as const));

export function parseAbstraction(input: unknown): AccountMode {
  const mode = RawAbstraction.parse(input);
  return mode === "unifiedAccount" || mode === "portfolioMargin" ? "pooled" : "perp";
}

export function parsePerpState(input: unknown): PerpState {
  const raw = RawClearinghouse.parse(input);
  const positions = raw.assetPositions.flatMap(({ position: p }): Position[] => {
    if (p.szi === 0) return [];
    const size = Math.abs(p.szi);
    return [
      {
        symbol: MarketSymbol.parse(p.coin),
        direction: p.szi > 0 ? "long" : "short",
        quantity: Qty.parse(size),
        entryPrice: Price.parse(p.entryPx),
        markPrice: Price.parse(p.positionValue / size),
        breakEvenPrice: null,
        liquidationPrice: p.liquidationPx === null ? null : Price.parse(p.liquidationPx),
        margin: p.leverage.type,
        leverage: p.leverage.value,
        notional: Usd.parse(p.positionValue),
        openPnl: Usd.parse(p.unrealizedPnl),
        cumulativeFunding: Usd.parse(-p.cumFunding.sinceOpen),
      },
    ];
  });
  return {
    positions,
    accountValue: raw.marginSummary.accountValue,
    withdrawable: raw.withdrawable,
    totalNotional: raw.marginSummary.totalNtlPos,
    totalMarginUsed: raw.marginSummary.totalMarginUsed,
    crossMaintenanceMargin: raw.crossMaintenanceMarginUsed,
    crossNotional: raw.crossMarginSummary.totalNtlPos,
    maxLeverage: raw.assetPositions.length === 0 ? null : Math.max(...raw.assetPositions.map((a) => a.position.maxLeverage)),
  };
}

export function parseSpotState(input: unknown): SpotState {
  const raw = RawSpotState.parse(input);
  return {
    balances: raw.balances.map(({ coin, token, total, hold }) => ({ coin, token, total, hold })),
    availableAfterMaintenance: new Map(raw.tokenToAvailableAfterMaintenance ?? []),
  };
}

export function parseSpotPricing(input: unknown): SpotPricing {
  const raw = RawSpotMeta.parse(input);
  const tokenNames = new Map(raw.tokens.map((t) => [t.index, t.name]));
  const pairNameByBase = new Map<number, string>();
  for (const pair of raw.universe) {
    const [base, quote] = pair.tokens;
    const quoteName = tokenNames.get(quote);
    if (quoteName !== undefined && STABLE_TOKENS.has(quoteName) && !pairNameByBase.has(base)) pairNameByBase.set(base, pair.name);
  }
  return { tokenNames, pairNameByBase };
}

export function parseMids(input: unknown): Record<string, number> {
  return RawMids.parse(input);
}

export function parsePerpDexNames(input: unknown): string[] {
  return RawPerpDexs.parse(input).flatMap((d) => (d === null ? [] : [d.name]));
}

const isSpotCoin = (coin: string) => coin.startsWith("@") || coin.includes("/");

export function dexOf(coin: string): string {
  const colon = coin.indexOf(":");
  return colon < 0 ? "" : coin.slice(0, colon);
}

export function parseOpenOrder(input: unknown): OpenOrder {
  const raw = RawOpenOrder.parse(input);
  const base = {
    id: String(raw.oid),
    symbol: MarketSymbol.parse(raw.coin),
    side: sideOf(raw.side),
    createdAt: Millis.parse(raw.timestamp),
    reduceOnly: raw.reduceOnly,
  };
  if (raw.isTrigger) {
    return {
      ...base,
      kind: "trigger",
      purpose: raw.orderType.startsWith("Stop") ? "stop" : raw.orderType.startsWith("Take Profit") ? "takeProfit" : "other",
      triggerPrice: Price.parse(raw.triggerPx),
      execution: raw.orderType.endsWith("Market") ? "market" : "limit",
      size: raw.isPositionTpsl ? { kind: "all" } : { kind: "quantity", quantity: Qty.parse(raw.sz) },
    };
  }
  return {
    ...base,
    kind: "limit",
    price: Price.parse(raw.limitPx),
    quantity: Qty.parse(raw.origSz),
    executedQuantity: Qty.parse(Math.max(0, raw.origSz - raw.sz)),
    postOnly: raw.tif === "Alo",
  };
}

export function parseOpenOrders(input: unknown): OpenOrder[] {
  return z.array(z.unknown()).parse(input).map(parseOpenOrder);
}

export function parseFills(input: unknown): Fill[] {
  return z
    .array(z.unknown())
    .parse(input)
    .flatMap((x): Fill[] => {
      const raw = RawFill.parse(x);
      if (isSpotCoin(raw.coin)) return [];
      if (!STABLE_TOKENS.has(raw.feeToken)) throw new Error(`perp fill ${raw.tid} charged its fee in ${raw.feeToken}, which has no fixed USD value`);
      return [
        {
          id: String(raw.tid),
          orderId: String(raw.oid),
          symbol: MarketSymbol.parse(raw.coin),
          side: sideOf(raw.side),
          price: Price.parse(raw.px),
          quantity: Qty.parse(raw.sz),
          fee: Usd.parse(raw.fee),
          liquidity: raw.crossed ? "taker" : "maker",
          market: "perp",
          closedPnl: Usd.parse(raw.closedPnl),
          at: Millis.parse(raw.time),
        },
      ];
    });
}

export function parseFunding(input: unknown): FundingPayment[] {
  return z
    .array(z.unknown())
    .parse(input)
    .map((x) => {
      const raw = RawFunding.parse(x);
      return {
        symbol: MarketSymbol.parse(raw.delta.coin),
        at: Millis.parse(raw.time),
        amount: Usd.parse(raw.delta.usdc),
        rate: raw.delta.fundingRate,
      };
    });
}

export function parseCandles(input: unknown): Candle[] {
  return z
    .array(z.unknown())
    .parse(input)
    .map((x) => {
      const raw = RawCandle.parse(x);
      return {
        start: Millis.parse(raw.t),
        open: Price.parse(raw.o),
        high: Price.parse(raw.h),
        low: Price.parse(raw.l),
        close: Price.parse(raw.c),
        volume: Qty.parse(raw.v),
      };
    });
}

const CANCELLED = /canceled$/i;

function statusOf(status: string, order: { isTrigger: boolean; sz: number; origSz: number }): OrderStatus | null {
  if (status === "filled" || status === "triggered") return "Filled";
  if (CANCELLED.test(status)) return "Cancelled";
  if (status === "open") return order.isTrigger ? "TriggerPending" : order.sz < order.origSz ? "PartiallyFilled" : "New";
  return null;
}

const STATUS_RANK = (status: string) => (status === "open" ? 0 : 1);

export function parseOrderHistory(input: unknown): OrderRecord[] {
  const latest = new Map<number, z.infer<typeof RawHistoricalOrder>>();
  const created = new Map<number, number>();
  for (const x of z.array(z.unknown()).parse(input)) {
    const raw = RawHistoricalOrder.parse(x);
    created.set(raw.order.oid, Math.min(created.get(raw.order.oid) ?? Infinity, raw.order.timestamp));
    const seen = latest.get(raw.order.oid);
    const newer =
      seen === undefined ||
      raw.statusTimestamp > seen.statusTimestamp ||
      (raw.statusTimestamp === seen.statusTimestamp && STATUS_RANK(raw.status) > STATUS_RANK(seen.status));
    if (newer) latest.set(raw.order.oid, raw);
  }
  return [...latest.values()].flatMap((raw): OrderRecord[] => {
    const { order } = raw;
    const status = statusOf(raw.status, order);
    if (status === null) return [];
    const kind = order.isTrigger ? "trigger" : order.orderType === "Limit" ? "limit" : "market";
    const level = kind === "trigger" ? order.triggerPx : kind === "limit" ? order.limitPx : null;
    const executed = status === "Filled" ? order.origSz : Math.max(0, order.origSz - order.sz);
    return [
      {
        id: String(order.oid),
        symbol: MarketSymbol.parse(order.coin),
        side: sideOf(order.side),
        kind,
        price: level === null ? null : Price.parse(level),
        quantity: Qty.parse(order.origSz),
        executedQuantity: Qty.parse(executed),
        status,
        createdAt: Millis.parse(created.get(order.oid)),
      },
    ];
  });
}
