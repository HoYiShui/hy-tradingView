import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { ReplayAnchor } from "../packages/types/src/index.js";
import { deriveBase, netPnl, reduceLedger, snapshotAt, sortLedger, type Marks } from "../packages/replay/src/index.js";
import { repoRoot } from "../apps/server/src/env.js";
import { loadAccount } from "./account.js";
import { loadLedger } from "./ledger.js";

const { account, direct } = loadAccount(process.argv[2]);
const db = new DatabaseSync(resolve(repoRoot, account.dbPath), { readOnly: true });

type Row = Record<string, string | number | null>;
const { fills, funding } = loadLedger(db);
const events = sortLedger([...fills, ...funding]);
const book = reduceLedger(events);

const equity = await direct.equity();
const real = await direct.positions();
const at = Date.now();
const marks: Record<string, number> = {};
for (const p of real) marks[p.symbol] = p.markPrice;
const markMap: Marks = Object.fromEntries(real.map((p) => [p.symbol, { price: p.markPrice, at }]));
const base = deriveBase(ReplayAnchor.parse({ at, equity, marks }), book);
const end = snapshotAt({ book, at, marks: markMap, base });

const realPnl = real.reduce((s, p) => s + p.openPnl, 0);
console.log(`account ${account.id}, events ${events.length} (${fills.length} fills, ${funding.length} funding)`);
console.log(`reconstructed realized ${book.realized.toFixed(4)} funding ${book.funding.toFixed(4)} fees ${book.fees.toFixed(4)} net ${netPnl(book).toFixed(4)}`);
console.log(`derived starting balance (equity - net pnl - open pnl): ${base.toFixed(4)}`);
console.log(`real equity ${equity.toFixed(4)}, replayed final equity ${end.equity.toFixed(4)}`);
console.log(`real positions ${real.length}, reconstructed ${end.positions.length}`);
for (const p of real) {
  const mine = end.positions.find((x) => x.symbol === p.symbol);
  console.log(`  ${p.symbol} real qty ${p.quantity} entry ${p.entryPrice} | replay qty ${mine ? (mine.direction === "long" ? mine.quantity : -mine.quantity) : 0} entry ${mine?.entryPrice ?? "-"}`);
}
for (const p of end.positions) if (!real.some((r) => r.symbol === p.symbol)) console.log(`  extra replay position ${p.symbol} ${p.quantity} @ ${p.entryPrice}`);
console.log(`real position-level pnl (realized+unrealized) ${realPnl.toFixed(4)}, replay realized+open ${(book.realized + end.metrics.openPnl).toFixed(4)}`);
const hist = db.prepare("SELECT SUM(realized) r, SUM(fees) f, SUM(funding) g FROM positions").get() as Row;
console.log(`position history realized ${Number(hist["r"]).toFixed(4)} fees ${Number(hist["f"]).toFixed(4)} funding ${Number(hist["g"]).toFixed(4)}`);
const spotFees = db.prepare("SELECT SUM(fee) s, COUNT(*) n FROM fills WHERE market = 'spot'").get() as Row;
console.log(`spot fills ${spotFees["n"]} with fees ${Number(spotFees["s"] ?? 0).toFixed(4)} (ignored by the reducer, like the exchange position fees)`);
const exchangeClosed = db.prepare("SELECT SUM(closed_pnl) c, COUNT(closed_pnl) n FROM fills WHERE market = 'perp'").get() as Row;
if (Number(exchangeClosed["n"]) > 0) {
  console.log(`exchange closedPnl on fills ${Number(exchangeClosed["c"]).toFixed(4)} vs reconstructed realized ${book.realized.toFixed(4)} (gap ${(book.realized - Number(exchangeClosed["c"])).toFixed(4)})`);
}
const transfers = await direct.transfers?.();
if (transfers !== undefined) {
  const net = transfers.reduce((s, t) => s + t.usd, 0);
  console.log(`transfers (not fills): ${transfers.map((t) => `${t.type} x${t.count} ${t.usd.toFixed(2)}`).join(", ")}, net ${net.toFixed(4)}`);
  console.log(`equity - net transfers - (realized + funding - fees + open pnl) = ${(equity - net - (netPnl(book) + end.metrics.openPnl)).toFixed(4)}`);
}
