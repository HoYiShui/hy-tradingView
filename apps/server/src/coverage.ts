export type Range = { from: number; to: number };

export function mergeRanges(ranges: readonly Range[]): Range[] {
  const sorted = ranges.filter((r) => r.to >= r.from).sort((a, b) => a.from - b.from);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out.at(-1);
    if (last && r.from <= last.to) last.to = Math.max(last.to, r.to);
    else out.push({ ...r });
  }
  return out;
}

export function uncovered(wanted: Range, covered: readonly Range[]): Range[] {
  const gaps: Range[] = [];
  let cursor = wanted.from;
  for (const c of mergeRanges(covered)) {
    if (c.to <= cursor) continue;
    if (c.from >= wanted.to) break;
    if (c.from > cursor) gaps.push({ from: cursor, to: Math.min(c.from, wanted.to) });
    cursor = Math.max(cursor, c.to);
  }
  if (cursor < wanted.to) gaps.push({ from: cursor, to: wanted.to });
  return gaps;
}

export function planFetches(wanted: Range, covered: readonly Range[], chunkMs: number): Range[] {
  const chunks: Range[] = [];
  for (const gap of uncovered(wanted, covered)) {
    for (let from = gap.from; from < gap.to; from += chunkMs) chunks.push({ from, to: Math.min(gap.to, from + chunkMs) });
  }
  return chunks.reverse();
}
