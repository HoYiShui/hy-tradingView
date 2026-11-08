import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { MarketSymbol, Millis, Price, Usd, Qty, type LedgerEvent } from "../packages/types/src/index.js";
import { deriveBase, netPnl, reduceLedger, snapshotAt, sortLedger, type Marks } from "../packages/replay/src/index.js";
import { loadConfig } from "../apps/server/src/config.js";
import { loadRootEnv, repoRoot } from "../apps/server/src/env.js";
import { createBackpackClient } from "../apps/server/src/backpack/client.js";

const { account } = loadRootEnv();
const config = loadConfig(process.env);
const client = createBackpackClient({ baseUrl: config.BACKPACK_API_URL, apiKey: config.BACKPACK_API_KEY, apiSecret: config.BACKPACK_API_SECRET });
const db = new DatabaseSync(resolve(repoRoot, config.DB_PATH), { readOnly: true });

type Row = Record<string, string | number | null>;
const fills = (db.prepare("SELECT * FROM fills").all() as Row[]).map((r): LedgerEvent => ({
  kind: "fill",
  fill: {
    id: String(r.id), orderId: String(r.order_id), symbol: MarketSymbol.parse(r.symbol),
    side: r.side === "buy" ? "buy" : "sell", price: Price.parse(r.price), quantity: Qty.parse(r.quantity),
    fee: Usd.parse(r.fee), liquidity: r.liquidity === "maker" ? "maker" : "taker", at: Millis.parse(r.at_ms),
  },
}));
const funding = (db.prepare("SELECT * FROM funding").all() as Row[]).map((r): LedgerEvent => ({
  kind: "funding",
  funding: { symbol: MarketSymbol.parse(r.symbol), at: Millis.parse(r.at_ms), amount: Usd.parse(r.amount) },
}));
const events = sortLedger([...fills, ...funding]);
const book = reduceLedger(events);

const collateral = (await client.signedGet("collateralQuery", "/api/v1/capital/collateral")) as Record<string, string>;
const real = (await client.signedGet("positionQuery", "/api/v1/position")) as Record<string, string>[];
const equity = Number(collateral["netEquity"]);
const marks: Record<string, number> = {};
for (const p of real) marks[String(p["symbol"])] = Number(p["markPrice"]);
const at = Date.now();
const markMap: Marks = Object.fromEntries(Object.entries(marks).map(([s, price]) => [s, { price, at }]));
const base = deriveBase({ at: Millis.parse(at), equity: Usd.parse(equity), marks }, book);
const end = snapshotAt({ book, at, marks: markMap, base });

const pnl = (rows: Record<string, string>[]) => rows.reduce((s, p) => s + Number(p["pnlRealized"]) + Number(p["pnlUnrealized"]), 0);
console.log(`account ${account}, events ${events.length} (${fills.length} fills, ${funding.length} funding)`);
console.log(`reconstructed realized ${book.realized.toFixed(4)} funding ${book.funding.toFixed(4)} fees ${book.fees.toFixed(4)} net ${netPnl(book).toFixed(4)}`);
console.log(`derived starting balance (equity - net pnl - open pnl): ${base.toFixed(4)}`);
console.log(`real equity ${equity.toFixed(4)}, replayed final equity ${end.equity.toFixed(4)}`);
console.log(`real positions ${real.length}, reconstructed ${end.positions.length}`);
for (const p of real) {
  const mine = end.positions.find((x) => x.symbol === p["symbol"]);
  const q = Number(p["netQuantity"]);
  console.log(`  ${p["symbol"]} real qty ${q} entry ${p["entryPrice"]} | replay qty ${mine ? (mine.direction === "long" ? mine.quantity : -mine.quantity) : 0} entry ${mine?.entryPrice ?? "-"}`);
}
for (const p of end.positions) if (!real.some((r) => r["symbol"] === p.symbol)) console.log(`  extra replay position ${p.symbol} ${p.quantity} @ ${p.entryPrice}`);
console.log(`real position-level pnl (realized+unrealized) ${pnl(real).toFixed(4)}, replay realized+open ${(book.realized + end.metrics.openPnl).toFixed(4)}`);
const hist = db.prepare("SELECT SUM(realized) r, SUM(fees) f, SUM(funding) g FROM positions").get() as Row;
console.log(`position history realized ${Number(hist["r"]).toFixed(4)} fees ${Number(hist["f"]).toFixed(4)} funding ${Number(hist["g"]).toFixed(4)}`);
const spotFees = (db.prepare("SELECT SUM(fee) s, COUNT(*) n FROM fills WHERE symbol NOT LIKE '%\\_PERP' ESCAPE '\\'").get() as Row);
console.log(`spot fills ${spotFees["n"]} with fees ${Number(spotFees["s"] ?? 0).toFixed(4)} (ignored by the reducer, like the exchange position fees)`);
