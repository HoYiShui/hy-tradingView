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
const { fills, funding, transfers } = loadLedger(db);
const events = sortLedger([...fills, ...funding, ...transfers]);
const book = reduceLedger(events);
const bookWithoutTransfers = reduceLedger(sortLedger([...fills, ...funding]));

const equity = await direct.equity();
const real = await direct.positions();
const at = Date.now();
const marks: Record<string, number> = {};
for (const p of real) marks[p.symbol] = p.markPrice;
const markMap: Marks = Object.fromEntries(real.map((p) => [p.symbol, { price: p.markPrice, at }]));
const base = deriveBase(ReplayAnchor.parse({ at, equity, marks }), book);
const end = snapshotAt({ book, at, marks: markMap, base });

const realPnl = real.reduce((s, p) => s + p.openPnl, 0);
console.log(`account ${account.id}, events ${events.length} (${fills.length} fills, ${funding.length} funding, ${transfers.length} transfers)`);
console.log(`reconstructed realized ${book.realized.toFixed(4)} funding ${book.funding.toFixed(4)} fees ${book.fees.toFixed(4)} net ${netPnl(book).toFixed(4)}`);
const baseWithout = deriveBase(ReplayAnchor.parse({ at, equity, marks }), bookWithoutTransfers);
console.log(`derived starting balance without transfers (equity - net pnl - open pnl): ${baseWithout.toFixed(4)}`);
console.log(`derived starting balance with ${transfers.length} transfers netting ${book.transfers.toFixed(4)}: ${base.toFixed(4)}`);
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
const spotCash = db.prepare("SELECT SUM(CASE side WHEN 'sell' THEN price * quantity ELSE -price * quantity END) c FROM fills WHERE market = 'spot' AND symbol NOT LIKE 'USDT%'").get() as Row;
console.log(`spot fills net cash flow, sells minus buys excluding stable pairs ${Number(spotCash["c"] ?? 0).toFixed(4)}`);
const exchangeClosed = db.prepare("SELECT SUM(closed_pnl) c, COUNT(closed_pnl) n FROM fills WHERE market = 'perp'").get() as Row;
if (Number(exchangeClosed["n"]) > 0) {
  console.log(`exchange closedPnl on fills ${Number(exchangeClosed["c"]).toFixed(4)} vs reconstructed realized ${book.realized.toFixed(4)} (gap ${(book.realized - Number(exchangeClosed["c"])).toFixed(4)})`);
}
const excluded = db.prepare("SELECT reason, asset, COUNT(*) n FROM transfers WHERE amount IS NULL GROUP BY reason, asset ORDER BY n DESC").all() as Row[];
const excludedCount = excluded.reduce((sum, r) => sum + Number(r["n"]), 0);
console.log(`excluded transfers (counted as warnings, not in the curve): ${excludedCount}${excluded.length > 0 ? ` (${excluded.map((r) => `${r["reason"]} ${r["asset"]} x${r["n"]}`).join(", ")})` : ""}`);
const directTransfers = await direct.transfers?.();
if (directTransfers !== undefined) {
  const net = directTransfers.reduce((s, t) => s + t.usd, 0);
  console.log(`direct ledger transfers: ${directTransfers.map((t) => `${t.type} x${t.count} ${t.usd.toFixed(2)}`).join(", ")}, net ${net.toFixed(4)}`);
  console.log(`stored net transfers ${book.transfers.toFixed(4)} vs direct ${net.toFixed(4)} (gap ${(book.transfers - net).toFixed(4)})`);
}
const residual = equity - book.transfers - (netPnl(book) + end.metrics.openPnl);
console.log(`residual starting balance after transfers (equity - net transfers - net pnl - open pnl) = ${residual.toFixed(4)}`);
