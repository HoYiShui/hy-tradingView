import {
  API, CANDLE_INTERVALS, type Candle, type CandleInterval, type Fill,
} from "@hy/types";
import {
  CandlestickSeries, createChart, createSeriesMarkers, HistogramSeries, LineStyle,
  type IChartApi, type IPriceLine, type ISeriesApi, type ISeriesMarkersPluginApi, type Time, type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePolled } from "../hooks/usePolled";
import { snapshotOf } from "../lib/status";
import { useAccount, useFeedState } from "../hooks/useAccount";
import { mergeCandles } from "../lib/candles";
import { price, qty } from "../lib/format";
import { buildFillMarkers, countUnmarked } from "../lib/markers";
import { buildPriceLines } from "../lib/orders";
import { COLOR } from "../lib/theme";
import { cn } from "../lib/utils";
import { BASE_CHART_OPTIONS } from "./chartTheme";
import { Panel } from "./Panel";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";

const LINE_STYLE = { solid: LineStyle.Solid, dotted: LineStyle.Dotted, dashed: LineStyle.Dashed } as const;
const POLL_MS = 3000;
const VOLUME_UP = "rgba(25,158,112,0.45)";
const VOLUME_DOWN = "rgba(217,89,38,0.45)";

interface Legend {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const toLegend = (c: Candle): Legend => ({ time: c.start, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume });
const ts = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp;
const volumePoint = (c: Candle) => ({ time: ts(c.start), value: c.volume, color: c.close >= c.open ? VOLUME_UP : VOLUME_DOWN });
const candlePoint = (c: Candle) => ({ time: ts(c.start), open: c.open, high: c.high, low: c.low, close: c.close });

const PAGE = 500;
const MAX_LABELLED_MARKERS = 25;
const LOAD_OLDER_WITHIN_BARS = 30;

async function fetchCandles(accountId: string, interval: CandleInterval, cursor: { since?: number; before?: number } = {}): Promise<Candle[]> {
  const q = new URLSearchParams({ interval, limit: String(PAGE) });
  if (cursor.since !== undefined) q.set("since", String(cursor.since));
  if (cursor.before !== undefined) q.set("before", String(cursor.before));
  const res = await fetch(`${API.account(accountId, "candles")}?${q}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as Candle[];
}

const NO_FILLS: Fill[] = [];

export function PriceChart({ className }: { className?: string }) {
  const { id: accountId, chartSymbol } = useAccount();
  const { data: fills } = usePolled<Fill[]>(`${API.account(accountId, "fills")}?limit=5000&symbol=${chartSymbol}`, 15_000, NO_FILLS);
  const snapshot = useFeedState((s) => snapshotOf(s.feed));
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeries = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeries = useRef<ISeriesApi<"Histogram"> | null>(null);
  const markerPlugin = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const priceLines = useRef<IPriceLine[]>([]);
  const candlesRef = useRef<Candle[]>([]);

  const [interval, setIntervalKey] = useState<CandleInterval>("15m");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [reachedStart, setReachedStart] = useState(false);
  const olderState = useRef({ loading: false, reachedStart: false, interval: "15m" as CandleInterval });
  const [hover, setHover] = useState<Legend | null>(null);

  useEffect(() => {
    const el = host.current;
    if (el === null) return;
    const chart = createChart(el, { ...BASE_CHART_OPTIONS, timeScale: { ...BASE_CHART_OPTIONS.timeScale, rightOffset: 6 } });
    const candle = chart.addSeries(CandlestickSeries, {
      upColor: COLOR.surface,
      borderUpColor: COLOR.up,
      wickUpColor: COLOR.up,
      downColor: COLOR.down,
      borderDownColor: COLOR.down,
      wickDownColor: COLOR.down,
      priceLineColor: COLOR.muted,
    });
    const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false }, 1);
    chart.panes()[0]?.setStretchFactor(4);
    chart.panes()[1]?.setStretchFactor(1);
    markerPlugin.current = createSeriesMarkers(candle, []);
    chart.subscribeCrosshairMove((p) => {
      const d = p.seriesData.get(candle);
      const v = p.seriesData.get(volume);
      if (d === undefined || !("open" in d)) return setHover(null);
      setHover({
        time: (p.time as number) * 1000,
        open: d.open, high: d.high, low: d.low, close: d.close,
        volume: v !== undefined && "value" in v ? v.value : 0,
      });
    });
    chartRef.current = chart;
    candleSeries.current = candle;
    volumeSeries.current = volume;
    return () => {
      chart.remove();
      chartRef.current = null;
      candleSeries.current = null;
      volumeSeries.current = null;
      markerPlugin.current = null;
      priceLines.current = [];
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    olderState.current = { loading: false, reachedStart: false, interval };
    setReachedStart(false);
    setLoadingOlder(false);
    fetchCandles(accountId, interval)
      .then((rows) => {
        if (cancelled) return;
        candlesRef.current = rows;
        candleSeries.current?.setData(rows.map(candlePoint));
        volumeSeries.current?.setData(rows.map(volumePoint));
        chartRef.current?.timeScale().fitContent();
        setCandles(rows);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });

    const poll = async () => {
      const last = candlesRef.current.at(-1);
      if (last === undefined || document.visibilityState !== "visible") return;
      try {
        const fresh = await fetchCandles(accountId, interval, { since: last.start });
        if (cancelled || fresh.length === 0) return;
        for (const c of fresh) {
          candleSeries.current?.update(candlePoint(c));
          volumeSeries.current?.update(volumePoint(c));
        }
        candlesRef.current = mergeCandles(candlesRef.current, fresh);
        setCandles(candlesRef.current);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };
    const id = setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
      candlesRef.current = [];
      setCandles([]);
    };
  }, [interval]);

  useEffect(() => {
    const chart = chartRef.current;
    if (chart === null) return;
    const onRange = (range: { from: number; to: number } | null) => {
      const st = olderState.current;
      const first = candlesRef.current[0];
      if (range === null || first === undefined || st.loading || st.reachedStart) return;
      if (range.from > LOAD_OLDER_WITHIN_BARS) return;
      const requested = st.interval;
      st.loading = true;
      setLoadingOlder(true);
      fetchCandles(accountId, requested, { before: first.start })
        .then((older) => {
          if (olderState.current.interval !== requested) return;
          if (older.length === 0) {
            olderState.current.reachedStart = true;
            setReachedStart(true);
            return;
          }
          const view = chart.timeScale().getVisibleLogicalRange();
          const merged = mergeCandles(candlesRef.current, older);
          const added = merged.length - candlesRef.current.length;
          candlesRef.current = merged;
          candleSeries.current?.setData(merged.map(candlePoint));
          volumeSeries.current?.setData(merged.map(volumePoint));
          if (view !== null) chart.timeScale().setVisibleLogicalRange({ from: view.from + added, to: view.to + added });
          setCandles(merged);
        })
        .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
        .finally(() => {
          if (olderState.current.interval !== requested) return;
          olderState.current.loading = false;
          setLoadingOlder(false);
        });
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    return () => chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
  }, []);

  const unmarked = useMemo(() => countUnmarked(fills, candles, interval, chartSymbol), [fills, candles, interval, chartSymbol]);

  const fillMarkers = useMemo(() => buildFillMarkers(fills, candles, interval, chartSymbol), [fills, candles, interval, chartSymbol]);

  useEffect(() => {
    const markers = fillMarkers.map((m) => ({
      time: m.time as UTCTimestamp, position: m.position, shape: m.shape, color: m.color, text: fillMarkers.length <= MAX_LABELLED_MARKERS ? m.text : "",
    }));
    markerPlugin.current?.setMarkers(markers);
  }, [fillMarkers]);

  useEffect(() => {
    const series = candleSeries.current;
    if (series === null) return;
    for (const l of priceLines.current) series.removePriceLine(l);
    const specs = snapshot === null ? [] : buildPriceLines(snapshot.openOrders, snapshot.positions, chartSymbol);
    priceLines.current = specs.map((s) =>
      series.createPriceLine({ price: s.price, color: s.color, lineStyle: LINE_STYLE[s.style], lineWidth: 1, axisLabelVisible: true, title: s.title }),
    );
  }, [snapshot]);

  const last = candles.at(-1);
  const shown = hover ?? (last === undefined ? null : toLegend(last));
  const shownFills = shown === null ? [] : fillMarkers.filter((m) => m.time === Math.floor(shown.time / 1000));

  return (
    <Panel
      title={`${chartSymbol.replace("_USDC_PERP", "-PERP")} candles`}
      className={className}
      aside={
        <Tabs value={interval} onValueChange={(v) => setIntervalKey(v as CandleInterval)}>
          <TabsList aria-label="Candle interval">
            {CANDLE_INTERVALS.map((i) => <TabsTrigger key={i} value={i}>{i}</TabsTrigger>)}
          </TabsList>
        </Tabs>
      }
    >
      <div className="flex flex-col gap-1.5">
        <div className="num flex min-h-[18px] flex-wrap gap-x-3.5 gap-y-1 text-xs">
          {shown === null ? (
            <span className="text-muted-foreground">{error !== null ? `Candles unavailable (${error})` : "Loading candles"}</span>
          ) : (
            <>
              <span className="text-muted-foreground">{new Date(shown.time).toISOString().slice(0, 16).replace("T", " ")}</span>
              <span>O <b className="font-semibold text-foreground">{price(shown.open)}</b></span>
              <span>H <b className="font-semibold text-foreground">{price(shown.high)}</b></span>
              <span>L <b className="font-semibold text-foreground">{price(shown.low)}</b></span>
              <span>C <b className="font-semibold text-foreground">{price(shown.close)}</b></span>
              <span>{shown.close >= shown.open ? "▲" : "▼"} {price(Math.abs(shown.close - shown.open))}</span>
              <span>Vol <b className="font-semibold text-foreground">{qty(shown.volume)}</b></span>
              {shownFills.map((m) => (
                <span key={m.side} className={m.side === "buy" ? "text-gain" : "text-loss"}>{m.detail}</span>
              ))}
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-secondary-foreground">
          <span><i className="mr-1.5 inline-block size-2.5 rounded-sm border-2 border-up bg-card align-[-1px]" />Up (hollow)</span>
          <span><i className="mr-1.5 inline-block size-2.5 rounded-sm border-2 border-down bg-down align-[-1px]" />Down (filled)</span>
          <span className="text-muted-foreground">Arrows: fills (hover candle for detail) · dashed: limit · dotted: trigger</span>
          {loadingOlder && <span className="text-muted-foreground" role="status">Loading older bars</span>}
          {reachedStart && <span className="text-muted-foreground">Start of data</span>}
          {unmarked > 0 && (
            <span className="text-muted-foreground" data-testid="unmarked-fills">
              {unmarked} {unmarked === 1 ? "fill" : "fills"} outside the loaded range{reachedStart ? " (no candles exist)" : ", scroll left to load"}
            </span>
          )}
        </div>
        <div ref={host} className="h-[380px] w-full sm:h-[520px]" />
      </div>
    </Panel>
  );
}
