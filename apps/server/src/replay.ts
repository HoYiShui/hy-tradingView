import { INTERVAL_MS, Millis, type MarketSymbol, Price, Usd, type AccountSnapshot, type CandleInterval, type ReplayPayload } from "@hy/types";
import { encodeCandles, encodeFills, encodeFunding, encodeOrders, encodeTransfers, orderSpans } from "@hy/replay";
import type { Store } from "./db.js";

const MAX_CANDLES = 120_000;

export function buildReplayPayload(input: { store: Store; snapshot: AccountSnapshot; interval: CandleInterval; symbol: MarketSymbol; chartError: string | null }): ReplayPayload {
  const { store, snapshot, interval, symbol, chartError } = input;
  const at = snapshot.asOf;
  const fills = store.allFills().filter((f) => f.market === "perp" && f.at <= at);
  const funding = store.allFunding().filter((f) => f.at <= at);
  const transfers = store.allTransfers().filter((t) => t.at <= at);
  const firstChartFill = store.earliestFillAt(symbol) ?? at;
  const step = INTERVAL_MS[interval];
  const from = Millis.parse(Math.floor(firstChartFill / step) * step - step);
  const candles = chartError === null ? store.candles({ symbol, interval, since: from, limit: MAX_CANDLES }) : [];
  const marks = Object.fromEntries(snapshot.positions.map((p) => [p.symbol, Price.parse(p.markPrice)]));
  return {
    interval,
    symbol,
    anchor: { at, equity: Usd.parse(snapshot.account.equity), marks },
    fills: encodeFills(fills),
    funding: encodeFunding(funding),
    transfers: encodeTransfers(transfers.flatMap((t) => (t.status === "counted" ? [{ at: t.at, amount: t.amount }] : []))),
    excludedTransfers: transfers.filter((t) => t.status === "excluded").length,
    candles: encodeCandles(candles),
    orders: encodeOrders(orderSpans({ orders: store.orders(), lastFillAt: store.lastFillByOrder(), now: at })),
    candlesComplete: (candles[0]?.start ?? Infinity) <= firstChartFill,
    chartError,
  };
}
