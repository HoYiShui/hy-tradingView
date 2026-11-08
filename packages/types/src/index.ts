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

export const EXCHANGES = ["backpack", "hyperliquid"] as const;
export const Exchange = z.enum(EXCHANGES);
export type Exchange = z.infer<typeof Exchange>;

export const Side = z.enum(["buy", "sell"]);
export type Side = z.infer<typeof Side>;

export const CANDLE_INTERVALS = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "8h", "12h", "1d", "3d", "1w", "1M"] as const;
export const CandleInterval = z.enum(CANDLE_INTERVALS);
export type CandleInterval = z.infer<typeof CandleInterval>;

const MINUTE = 60_000;
const DAY = 86_400_000;
// A month has no fixed length. This step is only used to align and size backfill ranges.
export const INTERVAL_MS: Record<CandleInterval, number> = {
  "1m": MINUTE,
  "3m": 3 * MINUTE,
  "5m": 5 * MINUTE,
  "15m": 15 * MINUTE,
  "30m": 30 * MINUTE,
  "1h": 60 * MINUTE,
  "2h": 120 * MINUTE,
  "4h": 240 * MINUTE,
  "8h": 480 * MINUTE,
  "12h": 720 * MINUTE,
  "1d": DAY,
  "3d": 3 * DAY,
  "1w": 7 * DAY,
  "1M": 30 * DAY,
};

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
  market: z.enum(["perp", "spot"]),
  closedPnl: Usd.nullable(),
  at: Millis,
});
export type Fill = z.infer<typeof Fill>;

export const Position = z.object({
  symbol: MarketSymbol,
  direction: z.enum(["long", "short"]),
  quantity: Qty,
  entryPrice: Price,
  markPrice: Price,
  breakEvenPrice: Price.nullable(),
  liquidationPrice: Price.nullable(),
  margin: z.enum(["cross", "isolated"]),
  leverage: z.number().nullable(),
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
    purpose: z.enum(["stop", "takeProfit", "other"]),
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
  leverageLimit: z.number().nullable(),
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

export const ORDER_STATUSES = ["New", "TriggerPending", "PartiallyFilled", "Filled", "Cancelled", "Expired", "TriggerFailed"] as const;
export const OrderStatus = z.enum(ORDER_STATUSES);
export type OrderStatus = z.infer<typeof OrderStatus>;

export const OrderRecord = z.object({
  id: z.string(),
  symbol: MarketSymbol,
  side: Side,
  kind: z.enum(["limit", "trigger", "market"]),
  price: Price.nullable(),
  quantity: Qty,
  executedQuantity: Qty,
  status: OrderStatus,
  createdAt: Millis,
});
export type OrderRecord = z.infer<typeof OrderRecord>;

export const OrderSpan = z.object({
  symbol: MarketSymbol,
  side: Side,
  kind: z.enum(["limit", "trigger"]),
  price: Price,
  quantity: Qty,
  from: Millis,
  to: Millis,
  estimated: z.boolean(),
});
export type OrderSpan = z.infer<typeof OrderSpan>;

export const ReplayPayload = z.object({
  interval: CandleInterval,
  symbol: MarketSymbol,
  anchor: ReplayAnchor,
  fills: z.array(z.tuple([z.string(), MarketSymbol, z.number(), Price, Qty, Usd, Millis])),
  funding: z.array(z.tuple([MarketSymbol, Millis, Usd])),
  candles: z.array(z.tuple([Millis, Price, Price, Price, Price, Qty])),
  orders: z.array(z.tuple([MarketSymbol, z.number(), z.number(), Price, Qty, Millis, Millis, z.number()])),
  candlesComplete: z.boolean(),
});
export type ReplayPayload = z.infer<typeof ReplayPayload>;

export const SURFACES = ["dashboard", "replay"] as const;
export const Surface = z.enum(SURFACES);
export type Surface = z.infer<typeof Surface>;

export const AccountInfo = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  exchange: Exchange,
  surfaces: z.array(Surface).min(1),
  chartSymbol: MarketSymbol,
  intervals: z.array(CandleInterval).min(1),
  history: z.object({ candleDepthBars: z.number().int().positive().nullable(), fillDepth: z.number().int().positive().nullable() }),
});
export type AccountInfo = z.infer<typeof AccountInfo>;
export const AccountList = z.array(AccountInfo);

export const ACCOUNT_LEAVES = {
  snapshot: "snapshot",
  stream: "stream",
  fills: "fills",
  candles: "candles",
  equity: "equity",
  dailyPnl: "daily-pnl",
} as const;

export const API = {
  accounts: "/api/accounts",
  replay: "/api/replay",
  account: (id: string, leaf: keyof typeof ACCOUNT_LEAVES): string =>
    `/api/accounts/${encodeURIComponent(id)}/${ACCOUNT_LEAVES[leaf]}`,
} as const;
