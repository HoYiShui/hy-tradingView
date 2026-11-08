import { Millis, type MarketSymbol, Price, Usd, type AccountSnapshot, type CandleInterval, type ReplayPayload } from "@hy/types";
import { encodeCandles, encodeFills, encodeFunding, encodeOrders, orderSpans } from "@hy/replay";
import type { Store } from "./db.js";
import { INTERVAL_MS } from "./history.js";

const MAX_CANDLES = 120_000;

export function buildReplayPayload(input: { store: Store; snapshot: AccountSnapshot; interval: CandleInterval; symbol: MarketSymbol }): ReplayPayload {
  const { store, snapshot, interval, symbol } = input;
  const at = snapshot.asOf;
  const fills = store.allFills().filter((f) => f.at <= at);
  const funding = store.allFunding().filter((f) => f.at <= at);
  const firstChartFill = store.earliestFillAt(symbol) ?? at;
  const step = INTERVAL_MS[interval];
  const from = Millis.parse(Math.floor(firstChartFill / step) * step - step);
  const candles = store.candles({ symbol, interval, since: from, limit: MAX_CANDLES });
  const marks = Object.fromEntries(snapshot.positions.map((p) => [p.symbol, Price.parse(p.markPrice)]));
  return {
    interval,
    symbol,
    anchor: { at, equity: Usd.parse(snapshot.account.equity), marks },
    fills: encodeFills(fills),
    funding: encodeFunding(funding),
    candles: encodeCandles(candles),
    orders: encodeOrders(orderSpans({ orders: store.orders(), lastFillAt: store.lastFillByOrder(), now: at })),
    candlesComplete: (candles[0]?.start ?? Infinity) <= firstChartFill,
  };
}
