import { z } from "zod";

const decimal = z.string().transform((s, ctx) => {
  const n = Number(s);
  if (s.trim() === "" || !Number.isFinite(n)) {
    ctx.addIssue({ code: "custom", message: `not a decimal: ${s}` });
    return z.NEVER;
  }
  return n;
});

const utcTimestamp = z.string().transform((s, ctx) => {
  const ms = Date.parse(`${s.replace(" ", "T")}Z`);
  if (!Number.isFinite(ms)) {
    ctx.addIssue({ code: "custom", message: `not a timestamp: ${s}` });
    return z.NEVER;
  }
  return ms;
});

export const RawAccount = z.object({
  leverageLimit: decimal,
  liquidating: z.boolean(),
});

export const RawCollateral = z.object({
  netEquity: decimal,
  netEquityAvailable: decimal,
  netEquityLocked: decimal,
  imf: decimal,
  mmf: decimal,
  marginFraction: decimal.nullable(),
});

export const RawPosition = z.object({
  symbol: z.string(),
  netQuantity: decimal,
  entryPrice: decimal,
  markPrice: decimal,
  breakEvenPrice: decimal,
  estLiquidationPrice: decimal,
  netExposureNotional: decimal,
  pnlRealized: decimal,
  pnlUnrealized: decimal,
  cumulativeFundingPayment: decimal,
});

export const RawOpenOrder = z.object({
  id: z.string(),
  symbol: z.string(),
  side: z.enum(["Bid", "Ask"]),
  orderType: z.enum(["Limit", "Market"]),
  createdAt: z.number().int(),
  price: decimal.nullish(),
  quantity: decimal.nullish(),
  executedQuantity: decimal,
  postOnly: z.boolean().default(false),
  reduceOnly: z.boolean().default(false),
  triggerPrice: decimal.nullish(),
  triggerQuantity: z.string().nullish(),
});

export const RawFill = z.object({
  tradeId: z.number().int(),
  orderId: z.string(),
  symbol: z.string(),
  side: z.enum(["Bid", "Ask"]),
  price: decimal,
  quantity: decimal,
  fee: decimal,
  isMaker: z.boolean(),
  timestamp: utcTimestamp,
});

export const RawFunding = z.object({
  symbol: z.string(),
  quantity: decimal,
  fundingRate: decimal,
  intervalEndTimestamp: utcTimestamp,
});

export const RawPositionHistory = z.object({
  id: z.string(),
  symbol: z.string(),
  openedAt: utcTimestamp,
  closedAt: utcTimestamp.nullable(),
  cumulativePnlRealized: decimal,
  fees: decimal,
  fundingQuantity: decimal,
});

export const RawKline = z.object({
  start: utcTimestamp,
  open: decimal,
  high: decimal,
  low: decimal,
  close: decimal,
  volume: decimal,
});

export const RawOrderHistory = z.object({
  id: z.string(),
  symbol: z.string(),
  side: z.enum(["Bid", "Ask"]),
  orderType: z.enum(["Limit", "Market"]),
  status: z.string(),
  price: decimal.nullish(),
  quantity: decimal.nullish(),
  executedQuantity: decimal,
  triggerPrice: decimal.nullish(),
  createdAt: utcTimestamp,
});
