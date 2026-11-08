import { ColorType, CrosshairMode, type DeepPartial, type ChartOptions } from "lightweight-charts";
import { COLOR } from "../lib/theme";

export const BASE_CHART_OPTIONS: DeepPartial<ChartOptions> = {
  autoSize: true,
  layout: {
    background: { type: ColorType.Solid, color: COLOR.surface },
    textColor: COLOR.muted,
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    fontSize: 11,
    panes: { separatorColor: COLOR.axis, enableResize: false },
  },
  grid: { vertLines: { color: COLOR.grid }, horzLines: { color: COLOR.grid } },
  rightPriceScale: { borderColor: COLOR.axis },
  timeScale: { borderColor: COLOR.axis, timeVisible: true, secondsVisible: false },
  crosshair: { mode: CrosshairMode.Normal },
};
