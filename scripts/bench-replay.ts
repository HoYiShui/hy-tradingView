import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { MarketSymbol, Millis, Price, Qty, Usd, type LedgerEvent } from "../packages/types/src/index.js";
import { buildTimeline, reduceLedger, seek, snapshotAt, sortLedger, START } from "../packages/replay/src/index.js";
import { repoRoot } from "../apps/server/src/env.js";
import { loadAccount } from "./account.js";

type Row = Record<string, string | number | null>;
const db = new DatabaseSync(resolve(repoRoot, loadAccount(process.argv[2]).account.dbPath), { readOnly: true });
const events = sortLedger([
  ...(db.prepare("SELECT * FROM fills").all() as Row[]).map((r): LedgerEvent => ({
    kind: "fill",
    fill: { id: String(r.id), orderId: "", symbol: MarketSymbol.parse(r.symbol), side: r.side === "buy" ? "buy" : "sell", price: Price.parse(r.price), quantity: Qty.parse(r.quantity), fee: Usd.parse(r.fee), liquidity: "taker", at: Millis.parse(r.at_ms) },
  })),
  ...(db.prepare("SELECT * FROM funding").all() as Row[]).map((r): LedgerEvent => ({ kind: "funding", funding: { symbol: MarketSymbol.parse(r.symbol), at: Millis.parse(r.at_ms), amount: Usd.parse(r.amount) } })),
]);
const first = events[0];
const last = events.at(-1);
if (!first || !last) throw new Error("no events");
const t0 = first.kind === "fill" ? first.fill.at : first.funding.at;
const t1 = last.kind === "fill" ? last.fill.at : last.funding.at;
const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return `median ${(s[s.length >> 1] ?? 0).toFixed(4)} ms, p99 ${(s[Math.floor(s.length * 0.99)] ?? 0).toFixed(4)} ms, max ${(s.at(-1) ?? 0).toFixed(3)} ms`;
};

let t = performance.now();
const full = reduceLedger(events);
console.log(`events ${events.length}, full reduction from zero ${(performance.now() - t).toFixed(1)} ms, realized ${full.realized.toFixed(2)}`);
t = performance.now();
const tl = buildTimeline(events);
console.log(`buildTimeline (checkpoints every ${tl.every}) ${(performance.now() - t).toFixed(1)} ms, ${tl.checkpoints.length} checkpoints`);

const frame = (cursor: typeof START, at: number) => {
  const c = seek(tl, cursor, at);
  snapshotAt({ book: c.book, at, marks: {}, base: 1000 });
  return c;
};

const FRAMES = 60 * 300;
const forward: number[] = [];
let cursor = START;
for (let i = 0; i <= FRAMES; i++) {
  const at = Math.floor(t0 + ((t1 - t0) * i) / FRAMES);
  const s = performance.now();
  cursor = frame(cursor, at);
  forward.push(performance.now() - s);
}
console.log(`playback, ${FRAMES} frames (1.2 days/s over the whole span at 60fps): ${stats(forward)}`);

const random: number[] = [];
let seed = 1;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
for (let i = 0; i < 5000; i++) {
  const s = performance.now();
  cursor = frame(cursor, Math.floor(t0 + (t1 - t0) * rnd()));
  random.push(performance.now() - s);
}
console.log(`random scrub, 5000 seeks: ${stats(random)}`);

const naive: number[] = [];
for (let i = 0; i < 20; i++) {
  const at = t0 + (t1 - t0) * rnd();
  const s = performance.now();
  reduceLedger(events.filter((e) => (e.kind === "fill" ? e.fill.at : e.funding.at) <= at));
  naive.push(performance.now() - s);
}
console.log(`naive recompute from zero per frame, 20 samples: ${stats(naive)}`);
