import type { CandleInterval } from "../../packages/types/src/index.js";

export type DirectPosition = { symbol: string; quantity: number; entryPrice: number; markPrice: number; notional: number; openPnl: number };

export type Transfers = { type: string; count: number; usd: number }[];

export type Direct = {
  secrets: readonly string[];
  equity(): Promise<number>;
  positions(): Promise<DirectPosition[]>;
  openOrderCount(): Promise<number>;
  fillCount(limit: number): Promise<number>;
  transfers?(): Promise<Transfers>;
  latestCandle(symbol: string, interval: CandleInterval): Promise<{ start: number; close: number }>;
};
