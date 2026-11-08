import { z } from "zod";
import { decimal } from "../decimal.js";

const MarginSummary = z.object({
  accountValue: decimal,
  totalNtlPos: decimal,
  totalRawUsd: decimal,
  totalMarginUsed: decimal,
});

const Leverage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("cross"), value: z.number() }),
  z.object({ type: z.literal("isolated"), value: z.number(), rawUsd: decimal }),
]);

export const RawPosition = z.object({
  coin: z.string(),
  szi: decimal,
  leverage: Leverage,
  entryPx: decimal,
  positionValue: decimal,
  unrealizedPnl: decimal,
  liquidationPx: decimal.nullable(),
  marginUsed: decimal,
  maxLeverage: z.number(),
  cumFunding: z.object({ allTime: decimal, sinceOpen: decimal, sinceChange: decimal }),
});

export const RawClearinghouse = z.object({
  marginSummary: MarginSummary,
  crossMarginSummary: MarginSummary,
  crossMaintenanceMarginUsed: decimal,
  withdrawable: decimal,
  assetPositions: z.array(z.object({ type: z.literal("oneWay"), position: RawPosition })),
  time: z.number().int(),
});

export const ABSTRACTION_MODES = ["default", "disabled", "unifiedAccount", "portfolioMargin", "dexAbstraction"] as const;
export const RawAbstraction = z.enum(ABSTRACTION_MODES).nullable();

export const RawSpotState = z.object({
  balances: z.array(z.object({ coin: z.string(), token: z.number().int(), total: decimal, hold: decimal, entryNtl: decimal })),
  tokenToAvailableAfterMaintenance: z.array(z.tuple([z.number().int(), decimal])).optional(),
});

export const RawOpenOrder = z.object({
  coin: z.string(),
  side: z.enum(["B", "A"]),
  limitPx: decimal,
  sz: decimal,
  oid: z.number().int(),
  timestamp: z.number().int(),
  triggerCondition: z.string(),
  isTrigger: z.boolean(),
  triggerPx: decimal,
  isPositionTpsl: z.boolean(),
  reduceOnly: z.boolean(),
  orderType: z.string(),
  origSz: decimal,
  tif: z.string().nullable(),
});

export const RawFill = z.object({
  coin: z.string(),
  px: decimal,
  sz: decimal,
  side: z.enum(["B", "A"]),
  time: z.number().int(),
  startPosition: decimal,
  dir: z.string(),
  closedPnl: decimal,
  oid: z.number().int(),
  crossed: z.boolean(),
  fee: decimal,
  tid: z.number().int(),
  feeToken: z.string(),
});

export const RawFunding = z.object({
  time: z.number().int(),
  delta: z.object({ type: z.literal("funding"), coin: z.string(), usdc: decimal, fundingRate: decimal }),
});

export const RawCandle = z.object({
  t: z.number().int(),
  o: decimal,
  h: decimal,
  l: decimal,
  c: decimal,
  v: decimal,
});

export const RawHistoricalOrder = z.object({
  order: z.object({
    coin: z.string(),
    side: z.enum(["B", "A"]),
    limitPx: decimal,
    sz: decimal,
    oid: z.number().int(),
    timestamp: z.number().int(),
    isTrigger: z.boolean(),
    triggerPx: decimal,
    orderType: z.string(),
    origSz: decimal,
  }),
  status: z.string(),
  statusTimestamp: z.number().int(),
});

export const RawPerpDexs = z.array(z.object({ name: z.string() }).nullable());

export const RawSpotMeta = z.object({
  tokens: z.array(z.object({ name: z.string(), index: z.number().int() })),
  universe: z.array(z.object({ name: z.string(), tokens: z.tuple([z.number().int(), z.number().int()]), index: z.number().int() })),
});

export const RawMids = z.record(z.string(), decimal);
