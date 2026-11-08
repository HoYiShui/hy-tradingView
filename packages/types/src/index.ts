import { z } from "zod";

export const Usd = z.number().finite().brand<"Usd">();
export type Usd = z.infer<typeof Usd>;
export const Price = z.number().finite().brand<"Price">();
export type Price = z.infer<typeof Price>;
export const Qty = z.number().finite().brand<"Qty">();
export type Qty = z.infer<typeof Qty>;
export const Millis = z.number().int().brand<"Millis">();
export type Millis = z.infer<typeof Millis>;
export const MarketSymbol = z.string().min(1).brand<"MarketSymbol">();
export type MarketSymbol = z.infer<typeof MarketSymbol>;
export const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).brand<"Day">();
export type Day = z.infer<typeof Day>;

export const Exchange = z.literal("backpack");
export type Exchange = z.infer<typeof Exchange>;

export const Side = z.enum(["buy", "sell"]);
export type Side = z.infer<typeof Side>;

export const CANDLE_INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d", "1w"] as const;
export const CandleInterval = z.enum(CANDLE_INTERVALS);
export type CandleInterval = z.infer<typeof CandleInterval>;

export const Candle = z.object({
  start: Millis,
  open: Price,
  high: Price,
  low: Price,
  close: Price,
  volume: Qty,
});
export type Candle = z.infer<typeof Candle>;

export const Fill = z.object({
  id: z.string(),
  orderId: z.string(),
  symbol: MarketSymbol,
  side: Side,
  price: Price,
  quantity: Qty,
  fee: Usd,
  liquidity: z.enum(["maker", "taker"]),
  at: Millis,
});
export type Fill = z.infer<typeof Fill>;

export const Position = z.object({
  symbol: MarketSymbol,
  direction: z.enum(["long", "short"]),
  quantity: Qty,
  entryPrice: Price,
  markPrice: Price,
  breakEvenPrice: Price,
  liquidationPrice: Price.nullable(),
  notional: Usd,
  openPnl: Usd,
  cumulativeFunding: Usd,
});
export type Position = z.infer<typeof Position>;

const OrderBase = {
  id: z.string(),
  symbol: MarketSymbol,
  side: Side,
  createdAt: Millis,
  reduceOnly: z.boolean(),
};

export const OpenOrder = z.discriminatedUnion("kind", [
  z.object({
    ...OrderBase,
    kind: z.literal("limit"),
    price: Price,
    quantity: Qty,
    executedQuantity: Qty,
    postOnly: z.boolean(),
  }),
  z.object({
    ...OrderBase,
    kind: z.literal("trigger"),
    triggerPrice: Price,
    execution: z.enum(["market", "limit"]),
    quantity: z.union([Qty, z.literal("all")]),
  }),
]);
export type OpenOrder = z.infer<typeof OpenOrder>;

export const AccountState = z.object({
  equity: Usd,
  availableEquity: Usd,
  lockedEquity: Usd,
  initialMarginFraction: z.number(),
  maintenanceMarginFraction: z.number(),
  marginFraction: z.number().nullable(),
  leverageLimit: z.number(),
  liquidating: z.boolean(),
});
export type AccountState = z.infer<typeof AccountState>;

export const AccountMetrics = z.object({
  grossNotional: Usd,
  netNotional: Usd,
  leverage: z.number().nullable(),
  openPnl: Usd,
});
export type AccountMetrics = z.infer<typeof AccountMetrics>;

export const AccountSnapshot = z.object({
  exchange: Exchange,
  asOf: Millis,
  account: AccountState,
  positions: z.array(Position),
  openOrders: z.array(OpenOrder),
  metrics: AccountMetrics,
});
export type AccountSnapshot = z.infer<typeof AccountSnapshot>;

export const Feed = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("connecting") }),
  z.object({ kind: z.literal("live"), snapshot: AccountSnapshot }),
  z.object({ kind: z.literal("stale"), snapshot: AccountSnapshot, since: Millis, reason: z.string() }),
  z.object({ kind: z.literal("down"), since: Millis, reason: z.string() }),
]);
export type Feed = z.infer<typeof Feed>;

export const DailyPnl = z.object({
  day: Day,
  trading: Usd,
  funding: Usd,
  total: Usd,
  cumulative: Usd,
});
export type DailyPnl = z.infer<typeof DailyPnl>;

export const CHART_SYMBOL = MarketSymbol.parse("BTC_USDC_PERP");

export const API = {
  feed: "/api/stream",
  feedOnce: "/api/feed",
  candles: "/api/candles",
  fills: "/api/fills",
  dailyPnl: "/api/pnl/daily",
} as const;
