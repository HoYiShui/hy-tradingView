import {
  createChart, createSeriesMarkers, LineSeries, LineType, type IChartApi, type ISeriesApi, type ISeriesMarkersPluginApi, type Time, type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef } from "react";
import type { Frame, ReplayModel } from "../lib/replayModel";
import { COLOR } from "../lib/theme";
import { transferMarkers } from "../lib/transferMarkers";
import { BASE_CHART_OPTIONS } from "./chartTheme";
import { Panel } from "./Panel";

const ts = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp;

export function ReplayEquity({ model, frame }: { model: ReplayModel; frame: Frame }) {
  const host = useRef<HTMLDivElement>(null);
  const line = useRef<ISeriesApi<"Line"> | null>(null);
  const markers = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const drawn = useRef({ points: -1, transfers: -1 });
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    const el = host.current;
    if (el === null) return;
    const chart = createChart(el, BASE_CHART_OPTIONS);
    line.current = chart.addSeries(LineSeries, { color: COLOR.accent, lineWidth: 2, lineType: LineType.Simple, priceLineVisible: false });
    const span = chart.addSeries(LineSeries, { visible: false, priceLineVisible: false, lastValueVisible: false });
    span.setData(model.curve.map((p) => ({ time: ts(p.ts) })));
    const first = model.curve[0];
    const last = model.curve.at(-1);
    if (first !== undefined && last !== undefined) chart.timeScale().setVisibleRange({ from: ts(first.ts), to: ts(last.ts) });
    markers.current = createSeriesMarkers(line.current, []);
    drawn.current = { points: -1, transfers: -1 };
    chartRef.current = chart;
    return () => {
      chart.remove();
      line.current = null;
      markers.current = null;
      chartRef.current = null;
    };
  }, [model]);

  useEffect(() => {
    const s = line.current;
    if (s === null) return;
    let n = 0;
    while (n < model.curve.length && (model.curve[n]?.ts ?? Infinity) <= frame.t) n++;
    const d = drawn.current.points;
    if (n !== d) {
      const pt = (i: number) => ({ time: ts(model.curve[i]?.ts ?? 0), value: model.curve[i]?.equity ?? 0 });
      if (d < 0 || n < d || n - d > 4) s.setData(model.curve.slice(0, n).map((_, i) => pt(i)));
      else for (let i = d; i < n; i++) s.update(pt(i));
      drawn.current.points = n;
    }
    if (n !== d || drawn.current.transfers !== frame.transferCount) {
      const shown = transferMarkers(model.curve.slice(0, n), model.transfers.slice(0, frame.transferCount));
      markers.current?.setMarkers(shown.map((m) => ({ ...m, time: ts(m.time), size: 0.6 })));
      drawn.current.transfers = frame.transferCount;
    }
  }, [model, frame]);

  return (
    <Panel
      title="Equity (back-derived, up to clock)"
      aside={model.transfers.length > 0 ? <span className="text-xs text-muted-foreground">arrows mark deposits and withdrawals</span> : undefined}
    >
      <div ref={host} className="h-[200px] w-full" />
    </Panel>
  );
}
