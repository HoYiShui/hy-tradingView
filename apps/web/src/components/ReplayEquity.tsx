import { createChart, LineSeries, LineType, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { useEffect, useRef } from "react";
import type { Frame, ReplayModel } from "../lib/replayModel";
import { COLOR } from "../lib/theme";
import { BASE_CHART_OPTIONS } from "./chartTheme";
import { Panel } from "./Panel";

const ts = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp;

export function ReplayEquity({ model, frame }: { model: ReplayModel; frame: Frame }) {
  const host = useRef<HTMLDivElement>(null);
  const line = useRef<ISeriesApi<"Line"> | null>(null);
  const drawn = useRef(-1);
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
    drawn.current = -1;
    chartRef.current = chart;
    return () => {
      chart.remove();
      line.current = null;
      chartRef.current = null;
    };
  }, [model]);

  useEffect(() => {
    const s = line.current;
    if (s === null) return;
    let n = 0;
    while (n < model.curve.length && (model.curve[n]?.ts ?? Infinity) <= frame.t) n++;
    const d = drawn.current;
    if (n === d) return;
    const pt = (i: number) => ({ time: ts(model.curve[i]?.ts ?? 0), value: model.curve[i]?.equity ?? 0 });
    if (d < 0 || n < d || n - d > 4) s.setData(model.curve.slice(0, n).map((_, i) => pt(i)));
    else for (let i = d; i < n; i++) s.update(pt(i));
    drawn.current = n;
  }, [model, frame]);

  return (
    <Panel title="Equity (back-derived, up to clock)">
      <div ref={host} className="h-[200px] w-full" />
    </Panel>
  );
}
