import type { AccountSnapshot, Candle, CandleInterval, Fill, MarketSymbol, OrderRecord, Millis } from "@hy/types";
import type { FundingPayment, PositionRecord } from "./backpack/parse.js";

export interface ExchangeReader {
  readonly exchange: string;
  readonly chartSymbol: MarketSymbol;
  fetchLive(): Promise<AccountSnapshot>;
  fetchFills(input: { from: Millis | null; limit: number; offset: number }): Promise<Fill[]>;
  fetchFunding(input: { from: Millis | null; limit: number; offset: number }): Promise<FundingPayment[]>;
  fetchPositionHistory(input: { limit: number; offset: number }): Promise<PositionRecord[]>;
  fetchOrderHistory(input: { limit: number; offset: number }): Promise<OrderRecord[]>;
  fetchCandles(input: { symbol: MarketSymbol; interval: CandleInterval; from: Millis; to: Millis }): Promise<Candle[]>;
}
