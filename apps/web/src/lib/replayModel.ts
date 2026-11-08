import {
  Millis, type Candle, type EquityPoint, type Fill, type OrderSpan, type ReplayAnchor, type ReplayPayload, type ReplayState,
} from "@hy/types";
import {
  buildTimeline, decodePayload, deriveBase, eventAt, openAt, reduceLedger, seek, snapshotAt, START,
  type Cursor, type Marks, type Timeline,
} from "@hy/replay";
import type { TransferMark } from "./transferMarkers";

const CURVE_POINTS = 1500;

export interface ReplayModel {
  readonly symbol: string;
  readonly interval: ReplayPayload["interval"];
  readonly start: number;
  readonly end: number;
  readonly timeline: Timeline;
  readonly fills: readonly Fill[];
  readonly fillTimes: readonly number[];
  readonly chartFills: readonly Fill[];
  readonly chartFillTimes: readonly number[];
  readonly candles: readonly Candle[];
  readonly orders: readonly OrderSpan[];
  readonly transfers: readonly TransferMark[];
  readonly transferTimes: readonly number[];
  readonly excludedTransfers: number;
  readonly anchor: ReplayAnchor;
  readonly base: number;
  readonly curve: readonly EquityPoint[];
  readonly candlesComplete: boolean;
}

export interface Frame {
  readonly t: number;
  readonly cursor: Cursor;
  readonly state: ReplayState;
  readonly openOrders: readonly OrderSpan[];
  readonly fillCount: number;
  readonly chartFillCount: number;
  readonly transferCount: number;
  readonly candleCount: number;
}

export function candleCountUpTo(candles: readonly Candle[], t: number): number {
  let lo = 0;
  let hi = candles.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const c = candles[mid];
    if (c !== undefined && c.start <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function marksAt(model: Pick<ReplayModel, "candles" | "symbol" | "anchor">, t: number, candleCount: number): Marks {
  if (t >= model.anchor.at) {
    return Object.fromEntries(Object.entries(model.anchor.marks).map(([s, price]) => [s, { price, at: model.anchor.at }]));
  }
  const c = model.candles[candleCount - 1];
  return c === undefined ? {} : { [model.symbol]: { price: c.open, at: c.start } };
}

const countTimes = (times: readonly number[], t: number): number => {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((times[mid] ?? 0) <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

export function frameAt(model: ReplayModel, prev: Cursor, time: number): Frame {
  const t = Math.floor(time);
  const cursor = seek(model.timeline, prev, t);
  const candleCount = candleCountUpTo(model.candles, t);
  const state = snapshotAt({ book: cursor.book, at: t, marks: marksAt(model, t, candleCount), base: model.base });
  return {
    t,
    cursor,
    state,
    openOrders: openAt(model.orders, t),
    fillCount: countTimes(model.fillTimes, t),
    chartFillCount: countTimes(model.chartFillTimes, t),
    transferCount: countTimes(model.transferTimes, t),
    candleCount,
  };
}

export function buildModel(payload: ReplayPayload): ReplayModel {
  const d = decodePayload(payload);
  const timeline = buildTimeline(d.ledger);
  const end = reduceLedger(d.ledger);
  const base = deriveBase(payload.anchor, end);
  const first = d.ledger[0];
  const startAt = first === undefined ? payload.anchor.at : eventAt(first);
  const transfers = payload.transfers.map(([at, amount]): TransferMark => ({ at, amount })).sort((a, b) => a.at - b.at);
  const chartFills = d.fills.filter((f) => f.symbol === payload.symbol);
  const partial = {
    symbol: payload.symbol, candles: d.candles, anchor: payload.anchor,
  };
  const curve: EquityPoint[] = [];
  let cursor = START;
  const span = Math.max(1, payload.anchor.at - startAt);
  for (let i = 0; i <= CURVE_POINTS; i++) {
    const t = Math.round(startAt + (span * i) / CURVE_POINTS);
    cursor = seek(timeline, cursor, t);
    const s = snapshotAt({ book: cursor.book, at: t, marks: marksAt(partial, t, candleCountUpTo(d.candles, t)), base });
    curve.push({ ts: Millis.parse(t), equity: s.equity, openPnl: s.metrics.openPnl, notional: s.metrics.grossNotional });
  }
  return {
    symbol: payload.symbol,
    interval: payload.interval,
    start: startAt,
    end: payload.anchor.at,
    timeline,
    fills: d.fills,
    fillTimes: d.fills.map((f) => f.at),
    chartFills,
    chartFillTimes: chartFills.map((f) => f.at),
    candles: d.candles,
    orders: d.orders,
    transfers,
    transferTimes: transfers.map((t) => t.at),
    excludedTransfers: payload.excludedTransfers,
    anchor: payload.anchor,
    base,
    curve,
    candlesComplete: payload.candlesComplete,
  };
}


