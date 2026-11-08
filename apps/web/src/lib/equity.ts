import { EQUITY_RANGES, type EquityPoint, type EquityRange } from "@hy/types";

export const RANGES = EQUITY_RANGES;

export interface EquityChange {
  from: number;
  to: number;
  delta: number;
  pct: number | null;
}

export function shapeEquity(points: readonly EquityPoint[]) {
  return {
    line: points.map((p) => ({ time: Math.floor(p.ts / 1000), value: p.equity })),
    byTime: new Map(points.map((p) => [Math.floor(p.ts / 1000), p])),
  };
}

export function equityChange(points: readonly EquityPoint[]): EquityChange | null {
  const first = points.at(0);
  const last = points.at(-1);
  if (first === undefined || last === undefined || points.length < 2) return null;
  return { from: first.equity, to: last.equity, delta: last.equity - first.equity, pct: first.equity > 0 ? (last.equity / first.equity - 1) * 100 : null };
}

export function equityUrl(base: string, range: EquityRange): string {
  return `${base}?range=${range}`;
}
