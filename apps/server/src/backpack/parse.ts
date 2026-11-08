import { z } from "zod";
import {
  Candle,
  Fill,
  MarketSymbol,
  Millis,
  OpenOrder,
  Position,
  Price,
  Qty,
  Usd,
} from "@hy/types";
import {
  RawAccount,
  RawCollateral,
  RawFill,
  RawFunding,
  RawKline,
  RawOpenOrder,
  RawPosition,
  RawPositionHistory,
} from "./raw.js";

export type FundingPayment = { symbol: MarketSymbol; at: Millis; amount: Usd; rate: number };
export type PositionRecord = {
  id: string;
  symbol: MarketSymbol;
  openedAt: Millis;
  closedAt: Millis | null;
  realizedPnl: Usd;
  fees: Usd;
  funding: Usd;
};

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
      triggerPrice: Price.parse(raw.triggerPrice),
      execution: raw.orderType === "Market" ? "market" : "limit",
      quantity: triggerQuantity(raw),
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

function triggerQuantity(raw: z.infer<typeof RawOpenOrder>): Qty | "all" {
  if (raw.triggerQuantity === "100%") return "all";
  if (raw.quantity != null && raw.quantity > 0) return Qty.parse(raw.quantity);
  throw new Error(`trigger order ${raw.id} has unsupported quantity ${raw.triggerQuantity ?? "null"}`);
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
