import { z } from "zod";
import {
  Candle,
  Fill,
  MarketSymbol,
  Millis,
  OpenOrder,
  OrderRecord,
  OrderStatus,
  Position,
  Percent,
  Price,
  Qty,
  type TriggerSize,
  Usd,
} from "@hy/types";
import type { FundingPayment, PositionRecord } from "../exchange.js";
import {
  RawAccount,
  RawCollateral,
  RawFill,
  RawFunding,
  RawKline,
  RawOpenOrder,
  RawOrderHistory,
  RawPosition,
  RawPositionHistory,
} from "./raw.js";

export type AccountParts = {
  account: z.infer<typeof RawAccount>;
  collateral: z.infer<typeof RawCollateral>;
};

const sideOf = (s: "Bid" | "Ask") => (s === "Bid" ? ("buy" as const) : ("sell" as const));

export function parsePosition(input: unknown): Position | null {
  const raw = RawPosition.parse(input);
  if (raw.netQuantity === 0) return null;
  return {
    symbol: MarketSymbol.parse(raw.symbol),
    direction: raw.netQuantity > 0 ? "long" : "short",
    quantity: Qty.parse(Math.abs(raw.netQuantity)),
    entryPrice: Price.parse(raw.entryPrice),
    markPrice: Price.parse(raw.markPrice),
    breakEvenPrice: Price.parse(raw.breakEvenPrice),
    liquidationPrice: raw.estLiquidationPrice > 0 ? Price.parse(raw.estLiquidationPrice) : null,
    margin: "cross",
    leverage: null,
    notional: Usd.parse(Math.abs(raw.netExposureNotional)),
    openPnl: Usd.parse(raw.pnlRealized + raw.pnlUnrealized),
    cumulativeFunding: Usd.parse(raw.cumulativeFundingPayment),
  };
}

export function parsePositions(input: unknown): Position[] {
  return z
    .array(z.unknown())
    .parse(input)
    .flatMap((p) => parsePosition(p) ?? []);
}

export function parseOpenOrder(input: unknown): OpenOrder {
  const raw = RawOpenOrder.parse(input);
  const base = {
    id: raw.id,
    symbol: MarketSymbol.parse(raw.symbol),
    side: sideOf(raw.side),
    createdAt: Millis.parse(raw.createdAt),
    reduceOnly: raw.reduceOnly,
  };
  if (raw.triggerPrice != null) {
    return {
      ...base,
      kind: "trigger",
      purpose: "other",
      triggerPrice: Price.parse(raw.triggerPrice),
      execution: raw.orderType === "Market" ? "market" : "limit",
      size: triggerSize(raw),
    };
  }
  if (raw.price == null || raw.quantity == null) {
    throw new Error(`open order ${raw.id} has neither a trigger nor a price and quantity`);
  }
  return {
    ...base,
    kind: "limit",
    price: Price.parse(raw.price),
    quantity: Qty.parse(raw.quantity),
    executedQuantity: Qty.parse(raw.executedQuantity),
    postOnly: raw.postOnly,
  };
}

const PERCENT = /^(\d+(?:\.\d+)?)%$/;

function triggerSize(raw: z.infer<typeof RawOpenOrder>): TriggerSize {
  const spec = raw.triggerQuantity;
  if (spec != null) {
    const pct = PERCENT.exec(spec);
    if (pct) {
      const value = Number(pct[1]);
      return value === 100 ? { kind: "all" } : { kind: "percent", percent: Percent.parse(value) };
    }
    const n = Number(spec);
    if (spec.trim() !== "" && Number.isFinite(n) && n > 0) return { kind: "quantity", quantity: Qty.parse(n) };
  }
  if (raw.quantity != null && raw.quantity > 0) return { kind: "quantity", quantity: Qty.parse(raw.quantity) };
  throw new Error(`trigger order ${raw.id} has unsupported quantity ${spec ?? "null"}`);
}

export function parseOpenOrders(input: unknown): OpenOrder[] {
  return z.array(z.unknown()).parse(input).map(parseOpenOrder);
}

export function parseAccountParts(account: unknown, collateral: unknown): AccountParts {
  return { account: RawAccount.parse(account), collateral: RawCollateral.parse(collateral) };
}

export function parseFill(input: unknown): Fill {
  const raw = RawFill.parse(input);
  return {
    id: String(raw.tradeId),
    orderId: raw.orderId,
    symbol: MarketSymbol.parse(raw.symbol),
    side: sideOf(raw.side),
    price: Price.parse(raw.price),
    quantity: Qty.parse(raw.quantity),
    fee: Usd.parse(raw.fee),
    liquidity: raw.isMaker ? "maker" : "taker",
    market: raw.symbol.endsWith("_PERP") ? "perp" : "spot",
    closedPnl: null,
    at: Millis.parse(raw.timestamp),
  };
}

export function parseFills(input: unknown): Fill[] {
  return z.array(z.unknown()).parse(input).map(parseFill);
}

export function parseFunding(input: unknown): FundingPayment[] {
  return z
    .array(z.unknown())
    .parse(input)
    .map((x) => {
      const raw = RawFunding.parse(x);
      return {
        symbol: MarketSymbol.parse(raw.symbol),
        at: Millis.parse(raw.intervalEndTimestamp),
        amount: Usd.parse(raw.quantity),
        rate: raw.fundingRate,
      };
    });
}

export function parsePositionHistory(input: unknown): PositionRecord[] {
  return z
    .array(z.unknown())
    .parse(input)
    .map((x) => {
      const raw = RawPositionHistory.parse(x);
      return {
        id: raw.id,
        symbol: MarketSymbol.parse(raw.symbol),
        openedAt: Millis.parse(raw.openedAt),
        closedAt: raw.closedAt === null ? null : Millis.parse(raw.closedAt),
        realizedPnl: Usd.parse(raw.cumulativePnlRealized),
        fees: Usd.parse(raw.fees),
        funding: Usd.parse(raw.fundingQuantity),
      };
    });
}

export function parseCandles(input: unknown): Candle[] {
  return z
    .array(z.unknown())
    .parse(input)
    .map((x) => {
      const raw = RawKline.parse(x);
      return {
        start: Millis.parse(raw.start),
        open: Price.parse(raw.open),
        high: Price.parse(raw.high),
        low: Price.parse(raw.low),
        close: Price.parse(raw.close),
        volume: Qty.parse(raw.volume),
      };
    });
}

export function parseOrderHistory(input: unknown): OrderRecord[] {
  return z
    .array(z.unknown())
    .parse(input)
    .flatMap((x) => {
      const raw = RawOrderHistory.parse(x);
      const status = OrderStatus.safeParse(raw.status);
      if (!status.success) return [];
      const kind = raw.triggerPrice != null ? "trigger" : raw.price != null ? "limit" : "market";
      const level = raw.triggerPrice ?? raw.price ?? null;
      return {
        id: raw.id,
        symbol: MarketSymbol.parse(raw.symbol),
        side: sideOf(raw.side),
        kind,
        price: level === null ? null : Price.parse(level),
        quantity: Qty.parse(raw.quantity ?? raw.executedQuantity),
        executedQuantity: Qty.parse(raw.executedQuantity),
        status: status.data,
        createdAt: Millis.parse(raw.createdAt),
      };
    });
}
