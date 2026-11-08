import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { buildTimeline, eventAt, reduceLedger, seek, snapshotAt, sortLedger, START } from "../packages/replay/src/index.js";
import { repoRoot } from "../apps/server/src/env.js";
import { loadAccount } from "./account.js";
import { loadLedger } from "./ledger.js";

const db = new DatabaseSync(resolve(repoRoot, loadAccount(process.argv[2]).account.dbPath), { readOnly: true });
const ledger = loadLedger(db);
const events = sortLedger([...ledger.fills, ...ledger.funding, ...ledger.transfers]);
const first = events[0];
const last = events.at(-1);
if (!first || !last) throw new Error("no events");
const t0 = eventAt(first);
const t1 = eventAt(last);
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
  reduceLedger(events.filter((e) => eventAt(e) <= at));
  naive.push(performance.now() - s);
}
console.log(`naive recompute from zero per frame, 20 samples: ${stats(naive)}`);
