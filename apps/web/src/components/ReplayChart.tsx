import type { Candle, Fill } from "@hy/types";
import {
  CandlestickSeries, createChart, createSeriesMarkers, type IChartApi, type ISeriesApi, type ISeriesMarkersPluginApi, type Time, type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef } from "react";
import { INTERVAL_MS } from "../lib/candles";
import type { Frame, ReplayModel } from "../lib/replayModel";
import { formingCandle, replayMarkers } from "../lib/replayMarkers";
import { COLOR } from "../lib/theme";
import { BASE_CHART_OPTIONS } from "./chartTheme";
import { Panel } from "./Panel";

const ts = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp;
const point = (c: Candle) => ({ time: ts(c.start), open: c.open, high: c.high, low: c.low, close: c.close });
const WINDOW_BARS = 140;

function lastShown(model: ReplayModel, frame: Frame): Candle | undefined {
  const last = model.candles[frame.candleCount - 1];
  if (last === undefined || frame.t >= last.start + INTERVAL_MS[model.interval]) return last;
  return formingCandle(last);
}

export function ReplayChart({ model, frame }: { model: ReplayModel; frame: Frame }) {
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markers = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const drawn = useRef({ candles: -1, fills: -1, lastTime: 0, forming: false });

  useEffect(() => {
    const el = host.current;
    if (el === null) return;
    const chart = createChart(el, { ...BASE_CHART_OPTIONS, timeScale: { ...BASE_CHART_OPTIONS.timeScale, rightOffset: 8 } });
    const candle = chart.addSeries(CandlestickSeries, {
      upColor: COLOR.surface, borderUpColor: COLOR.up, wickUpColor: COLOR.up,
      downColor: COLOR.down, borderDownColor: COLOR.down, wickDownColor: COLOR.down, priceLineColor: COLOR.muted,
    });
    markers.current = createSeriesMarkers(candle, []);
    chartRef.current = chart;
    series.current = candle;
    return () => {
      chart.remove();
      chartRef.current = null;
      series.current = null;
      markers.current = null;
      drawn.current = { candles: -1, fills: -1, lastTime: 0, forming: false };
    };
  }, [model]);

  useEffect(() => {
    const s = series.current;
    const chart = chartRef.current;
    if (s === null || chart === null) return;
    const d = drawn.current;
    const last = lastShown(model, frame);
    const advance = frame.candleCount - d.candles;
    if (advance < 0 || advance > 3 || d.candles < 0) {
      const done = model.candles.slice(0, Math.max(0, frame.candleCount - 1)).map(point);
      s.setData(last === undefined ? done : [...done, point(last)]);
    } else if (last !== undefined) {
      for (const c of model.candles.slice(Math.max(0, frame.candleCount - 1 - advance), frame.candleCount - 1)) s.update(point(c));
      s.update(point(last));
    }
    if (last !== undefined && (advance !== 0 || d.candles < 0)) {
      const n = frame.candleCount;
      chart.timeScale().setVisibleLogicalRange({ from: n - WINDOW_BARS, to: n + 8 });
    }
    d.candles = frame.candleCount;
    if (d.fills !== frame.chartFillCount || advance !== 0) {
      const fills: readonly Fill[] = model.chartFills.slice(0, frame.chartFillCount);
      markers.current?.setMarkers(replayMarkers(fills, model.candles.slice(0, frame.candleCount), model.interval).map((m) => ({ ...m, time: m.time as UTCTimestamp })));
      d.fills = frame.chartFillCount;
    }
  }, [model, frame]);

  return (
    <Panel title={`${model.symbol.replace("_USDC_PERP", "-PERP")} candles (${model.interval})`} aside={<span className="text-xs text-muted-foreground">{model.candlesComplete ? "" : "candles start after first fill"}</span>}>
      <div ref={host} className="h-[380px] w-full sm:h-[460px]" />
    </Panel>
  );
}
