import type { AccountInfo, AccountSnapshot, Candle, CandleInterval, Exchange, Fill, MarketSymbol, Millis, OrderRecord, Transfer, Usd } from "@hy/types";

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

export type ExchangeCapabilities = {
  intervals: readonly [CandleInterval, ...CandleInterval[]];
  history: AccountInfo["history"];
  minLivePollMs: number;
  minSyncMs: number;
  minCandleRefreshMs: number;
};

export interface ExchangeReader {
  readonly exchange: Exchange;
  readonly chartSymbol: MarketSymbol;
  readonly capabilities: ExchangeCapabilities;
  fetchLive(): Promise<AccountSnapshot>;
  fetchFills(input: { from: Millis | null }): Promise<Fill[]>;
  fetchFunding(input: { from: Millis | null }): Promise<FundingPayment[]>;
  fetchPositionHistory(): Promise<PositionRecord[]>;
  fetchTransfers(input: { from: Millis | null }): Promise<Transfer[]>;
  orderHistory(): AsyncIterable<OrderRecord[]>;
  fetchCandles(input: { symbol: MarketSymbol; interval: CandleInterval; from: Millis; to: Millis }): Promise<Candle[]>;
}
