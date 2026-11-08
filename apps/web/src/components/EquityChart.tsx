import { API, type EquityPoint, type EquityRange } from "@hy/types";
import { createChart, LineSeries, LineType, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePolled } from "../hooks/usePolled";
import { equityChange, equityUrl, RANGES, shapeEquity } from "../lib/equity";
import { SIGN_MARK, signedUsd, signOf, usd } from "../lib/format";
import { COLOR } from "../lib/theme";
import { SIGN_TEXT } from "../lib/utils";
import { BASE_CHART_OPTIONS } from "./chartTheme";
import { Empty } from "./Panel";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";

const NO_POINTS: EquityPoint[] = [];

export function EquityChart() {
  const [range, setRange] = useState<EquityRange>("7d");
  const { data, loaded, error } = usePolled<EquityPoint[]>(equityUrl(API.equity, range), 30_000, NO_POINTS);
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const line = useRef<ISeriesApi<"Line"> | null>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const shaped = useMemo(() => shapeEquity(data), [data]);
  const change = useMemo(() => equityChange(data), [data]);
  const enough = data.length >= 2;

  useEffect(() => {
    const el = host.current;
    if (el === null) return;
    const chart = createChart(el, BASE_CHART_OPTIONS);
    line.current = chart.addSeries(LineSeries, { color: COLOR.accent, lineWidth: 2, lineType: LineType.Simple, priceLineVisible: false });
    chart.subscribeCrosshairMove((p) => setHoverTime(typeof p.time === "number" ? p.time : null));
    chartRef.current = chart;
    return () => {
      chart.remove();
      chartRef.current = null;
      line.current = null;
    };
  }, [enough]);

  useEffect(() => {
    line.current?.setData(shaped.line.map((d) => ({ time: d.time as UTCTimestamp, value: d.value })));
    chartRef.current?.timeScale().fitContent();
  }, [shaped, enough]);

  const focus = (hoverTime === null ? data.at(-1) : shaped.byTime.get(hoverTime)) ?? null;
  const sign = change === null ? "flat" : signOf(change.delta);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <div className="num flex min-h-[18px] flex-wrap gap-x-3.5 gap-y-1 text-xs">
          <span className="whitespace-nowrap"><i className="mr-1.5 inline-block h-0.5 w-3 bg-primary align-[3px]" />Equity</span>
          {focus !== null && (
            <>
              <span className="text-muted-foreground">{new Date(focus.ts).toISOString().slice(0, 16).replace("T", " ")} UTC</span>
              <b className="font-semibold text-foreground">{usd(focus.equity)}</b>
              <span className="text-muted-foreground">open PnL {signedUsd(focus.openPnl)} · gross {usd(focus.notional)}</span>
            </>
          )}
          {change !== null && (
            <span className={SIGN_TEXT[sign]}>
              {SIGN_MARK[sign]} {signedUsd(change.delta)}{change.pct === null ? "" : ` (${change.pct >= 0 ? "+" : ""}${change.pct.toFixed(2)}%)`} over range
            </span>
          )}
        </div>
        <Tabs value={range} onValueChange={(v) => setRange(v as EquityRange)}>
          <TabsList aria-label="Equity range">
            {RANGES.map((r) => <TabsTrigger key={r} value={r}>{r}</TabsTrigger>)}
          </TabsList>
        </Tabs>
      </div>
      {enough ? (
        <div ref={host} className="h-[200px] w-full" />
      ) : (
        <Empty>{error !== null ? `Could not load equity (${error})` : !loaded ? "Loading equity" : data.length === 1 ? `Recording started. One point so far (${usd(data[0]?.equity ?? 0)}). The curve appears as snapshots accumulate every 5 minutes.` : "No equity snapshots yet."}</Empty>
      )}
    </div>
  );
}
