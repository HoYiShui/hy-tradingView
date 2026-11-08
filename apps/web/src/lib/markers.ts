import { CHART_SYMBOL, type Candle, type CandleInterval, type Fill, type Side } from "@hy/types";
import { findCandleStart } from "./candles";
import { price, qty } from "./format";
import { COLOR } from "./theme";

export interface MarkerSpec {
  time: number;
  side: Side;
  position: "aboveBar" | "belowBar";
  shape: "arrowUp" | "arrowDown";
  color: string;
  text: string;
  detail: string;
}

interface Bucket {
  start: number;
  side: Side;
  qty: number;
  notional: number;
  count: number;
}

export function buildFillMarkers(
  fills: readonly Fill[],
  candles: readonly Candle[],
  interval: CandleInterval,
  symbol: string = CHART_SYMBOL,
): MarkerSpec[] {
  const buckets = new Map<string, Bucket>();
  for (const f of fills) {
    if (f.symbol !== symbol) continue;
    const start = findCandleStart(candles, f.at, interval);
    if (start === null) continue;
    const key = `${start}:${f.side}`;
    const b = buckets.get(key) ?? { start, side: f.side, qty: 0, notional: 0, count: 0 };
    b.qty += f.quantity;
    b.notional += f.quantity * f.price;
    b.count += 1;
    buckets.set(key, b);
  }
  return [...buckets.values()]
    .map((b): MarkerSpec => {
      const buy = b.side === "buy";
      const avg = b.qty > 0 ? b.notional / b.qty : 0;
      const verb = buy ? "Buy" : "Sell";
      const many = b.count > 1 ? ` (${b.count} fills)` : "";
      return {
        time: Math.floor(b.start / 1000),
        side: b.side,
        position: buy ? "belowBar" : "aboveBar",
        shape: buy ? "arrowUp" : "arrowDown",
        color: buy ? COLOR.up : COLOR.down,
        text: `${buy ? "B" : "S"} ${qty(b.qty)}`,
        detail: `${verb} ${qty(b.qty)} @ ${price(avg)}${many}`,
      };
    })
    .sort((a, b) => a.time - b.time || a.side.localeCompare(b.side));
}
