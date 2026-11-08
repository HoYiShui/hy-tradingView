import type { Candle, CandleInterval, Fill } from "@hy/types";
import { buildFillMarkers } from "./markers";

export const MAX_LABELLED_MARKERS = 25;

export function replayMarkers(fills: readonly Fill[], candles: readonly Candle[], interval: CandleInterval) {
  const specs = buildFillMarkers(fills, candles, interval);
  const labelled = specs.length <= MAX_LABELLED_MARKERS;
  return specs.map((m) => ({ time: m.time, position: m.position, shape: m.shape, color: m.color, text: labelled ? m.text : "" }));
}

export function formingCandle(c: Candle): Candle {
  return { ...c, high: c.open, low: c.open, close: c.open };
}
