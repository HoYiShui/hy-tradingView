import type { AccountInfo } from "@hy/types";

const count = (n: number) => n.toLocaleString("en-US");

export function historyLimit(history: AccountInfo["history"]): string | null {
  const parts = [
    ...(history.candleDepthBars === null ? [] : [`${count(history.candleDepthBars)} bars per interval`]),
    ...(history.fillDepth === null ? [] : [`${count(history.fillDepth)} fills`]),
  ];
  return parts.length === 0 ? null : `History limited to the last ${parts.join(" and ")}.`;
}

export function firstInterval<T extends string>(wanted: readonly T[], available: readonly T[]): T | null {
  return wanted.find((i) => available.includes(i)) ?? available[0] ?? null;
}
