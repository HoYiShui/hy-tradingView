import type { EquityPoint } from "@hy/types";
import { COLOR } from "./theme";

export interface TransferMark {
  readonly at: number;
  readonly amount: number;
}

export interface TransferMarker {
  time: number;
  position: "aboveBar" | "belowBar";
  shape: "arrowUp" | "arrowDown";
  color: string;
  text: string;
}

function lastAtOrBefore(curve: readonly EquityPoint[], at: number): number {
  let lo = 0;
  let hi = curve.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((curve[mid]?.ts ?? Infinity) <= at) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

export function transferMarkers(curve: readonly EquityPoint[], transfers: readonly TransferMark[]): TransferMarker[] {
  const slots = new Map<string, TransferMarker>();
  for (const t of transfers) {
    const i = lastAtOrBefore(curve, t.at);
    const point = curve[i];
    if (point === undefined || t.amount === 0) continue;
    const into = t.amount > 0;
    const key = `${point.ts}:${into}`;
    if (slots.has(key)) continue;
    slots.set(key, {
      time: point.ts,
      position: into ? "belowBar" : "aboveBar",
      shape: into ? "arrowUp" : "arrowDown",
      color: COLOR.muted,
      text: "",
    });
  }
  return [...slots.values()].sort((a, b) => a.time - b.time);
}
