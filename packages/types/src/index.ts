import { z } from "zod";

export const Usd = z.number().finite().brand<"Usd">();
export type Usd = z.infer<typeof Usd>;
export const Price = z.number().finite().brand<"Price">();
export type Price = z.infer<typeof Price>;
export const Qty = z.number().finite().brand<"Qty">();
export type Qty = z.infer<typeof Qty>;
export const Percent = z.number().gt(0).lt(100).brand<"Percent">();
export type Percent = z.infer<typeof Percent>;
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

export const TriggerSize = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("all") }),
  z.object({ kind: z.literal("percent"), percent: Percent }),
  z.object({ kind: z.literal("quantity"), quantity: Qty }),
]);
export type TriggerSize = z.infer<typeof TriggerSize>;

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
    size: TriggerSize,
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

export const EQUITY_RANGES = ["1d", "7d", "30d", "all"] as const;
export const EquityRange = z.enum(EQUITY_RANGES);
export type EquityRange = z.infer<typeof EquityRange>;

export const EquityPoint = z.object({
  ts: Millis,
  equity: Usd,
  openPnl: Usd,
  notional: Usd,
});
export type EquityPoint = z.infer<typeof EquityPoint>;

export const FundingEvent = z.object({ symbol: MarketSymbol, at: Millis, amount: Usd });
export type FundingEvent = z.infer<typeof FundingEvent>;

export const LedgerEvent = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("fill"), fill: Fill }),
  z.object({ kind: z.literal("funding"), funding: FundingEvent }),
]);
export type LedgerEvent = z.infer<typeof LedgerEvent>;

export const ReplayAnchor = z.object({
  at: Millis,
  equity: Usd,
  marks: z.record(MarketSymbol, Price),
});
export type ReplayAnchor = z.infer<typeof ReplayAnchor>;

export const ReplayTotals = z.object({ realized: Usd, funding: Usd, fees: Usd });
export type ReplayTotals = z.infer<typeof ReplayTotals>;

export const ReplayState = z.object({
  at: Millis,
  equity: Usd,
  positions: z.array(Position),
  metrics: AccountMetrics,
  totals: ReplayTotals,
});
export type ReplayState = z.infer<typeof ReplayState>;

export const CHART_SYMBOL = MarketSymbol.parse("BTC_USDC_PERP");

export const API = {
  feed: "/api/stream",
  feedOnce: "/api/feed",
  candles: "/api/candles",
  fills: "/api/fills",
  dailyPnl: "/api/pnl/daily",
  equity: "/api/equity",
} as const;
