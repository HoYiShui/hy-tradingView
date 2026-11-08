import type { DailyPnl } from "@hy/types";
import { COLOR } from "./theme";

export interface PnlBar {
  time: string;
  value: number;
  color: string;
}

export interface PnlSeries {
  bars: PnlBar[];
  cumulative: { time: string; value: number }[];
  byDay: Map<string, DailyPnl>;
}

export function shapePnl(days: readonly DailyPnl[]): PnlSeries {
  return {
    bars: days.map((d) => ({ time: d.day, value: d.total, color: d.total >= 0 ? COLOR.up : COLOR.down })),
    cumulative: days.map((d) => ({ time: d.day, value: d.cumulative })),
    byDay: new Map(days.map((d) => [d.day, d])),
  };
}
