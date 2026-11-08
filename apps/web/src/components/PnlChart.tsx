import type { DailyPnl } from "@hy/types";
import {
  createChart, HistogramSeries, LineSeries, LineType, type IChartApi, type ISeriesApi, type Time,
} from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import { SIGN_MARK, signedUsd, signOf } from "../lib/format";
import { shapePnl } from "../lib/pnl";
import { COLOR } from "../lib/theme";
import { BASE_CHART_OPTIONS } from "./chartTheme";
import { SIGN_TEXT, cn } from "../lib/utils";
import { Empty } from "./Panel";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

export function PnlChart({ days, loaded, error }: { days: readonly DailyPnl[]; loaded: boolean; error: string | null }) {
  const host = useRef<HTMLDivElement>(null);
  const bars = useRef<ISeriesApi<"Histogram"> | null>(null);
  const line = useRef<ISeriesApi<"Line"> | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [hoverDay, setHoverDay] = useState<string | null>(null);
  const shaped = useMemo(() => shapePnl(days), [days]);
  const empty = days.length === 0;

  useEffect(() => {
    const el = host.current;
    if (el === null) return;
    const chart = createChart(el, { ...BASE_CHART_OPTIONS, timeScale: { ...BASE_CHART_OPTIONS.timeScale, timeVisible: false, barSpacing: 24, rightOffset: 2 } });
    const b = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false });
    const l = chart.addSeries(LineSeries, { color: COLOR.accent, lineWidth: 2, lineType: LineType.Simple, priceLineVisible: false });
    chart.subscribeCrosshairMove((p) => setHoverDay(typeof p.time === "string" ? p.time : null));
    chartRef.current = chart;
    bars.current = b;
    line.current = l;
    return () => {
      chart.remove();
      chartRef.current = null;
      bars.current = null;
      line.current = null;
    };
  }, [empty]);

  useEffect(() => {
    bars.current?.setData(shaped.bars.map((d) => ({ ...d, time: d.time as Time })));
    line.current?.setData(shaped.cumulative.map((d) => ({ ...d, time: d.time as Time })));
    if (shaped.bars.length > 30) chartRef.current?.timeScale().fitContent();
    else chartRef.current?.timeScale().scrollToRealTime();
  }, [shaped, empty]);

  const focus = (hoverDay === null ? days.at(-1) : shaped.byDay.get(hoverDay)) ?? null;

  return (
    <>
      {empty ? (
        <Empty>{error !== null ? `Could not load PnL (${error})` : loaded ? "No closed PnL yet. Bars appear after the first realized day." : "Loading PnL"}</Empty>
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="num flex min-h-[18px] flex-wrap gap-x-3.5 gap-y-1 text-xs">
            <span className="whitespace-nowrap"><i className="mr-1.5 inline-block size-2.5 rounded-sm bg-up align-[-1px]" />Daily total</span>
            <span className="whitespace-nowrap"><i className="mr-1.5 inline-block h-0.5 w-3 bg-primary align-[3px]" />Cumulative</span>
            {focus !== null && (
              <>
                <span className="text-muted-foreground">{focus.day}</span>
                <span className={SIGN_TEXT[signOf(focus.total)]}>{SIGN_MARK[signOf(focus.total)]} {signedUsd(focus.total)}</span>
                <span className="text-muted-foreground">trading {signedUsd(focus.trading)} · funding {signedUsd(focus.funding)}</span>
                <span>cum <b className="font-semibold text-foreground">{signedUsd(focus.cumulative)}</b></span>
              </>
            )}
          </div>
          <div ref={host} className="h-[200px] w-full" />
          <Table containerClassName="max-h-44 overflow-y-auto" aria-label="Daily PnL table">
            <TableHeader>
              <TableRow>
                <TableHead>Day (UTC)</TableHead>
                {["Trading", "Funding", "Total", "Cumulative"].map((h) => <TableHead key={h} className="text-right">{h}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...days].reverse().map((d) => {
                const s = signOf(d.total);
                return (
                  <TableRow key={d.day}>
                    <TableCell className="num">{d.day}</TableCell>
                    <TableCell className="num text-right">{signedUsd(d.trading)}</TableCell>
                    <TableCell className="num text-right">{signedUsd(d.funding)}</TableCell>
                    <TableCell className={cn("num text-right", SIGN_TEXT[s])}>{SIGN_MARK[s]} {signedUsd(d.total)}</TableCell>
                    <TableCell className="num text-right">{signedUsd(d.cumulative)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
