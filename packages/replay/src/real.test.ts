import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MarketSymbol, Millis, Price, Qty, Usd, type LedgerEvent } from "@hy/types";
import { reduceLedger, sortLedger } from "./reducer.js";

const DB = new URL("../../../data/test.db", import.meta.url).pathname;

type Row = Record<string, string | number | null>;

describe.skipIf(!existsSync(DB))("saved real account (data/test.db)", () => {
  it("reproduces the exchange's per-symbol realized pnl, fees and funding, and ends flat", () => {
    const db = new DatabaseSync(DB, { readOnly: true });
    const fills = (db.prepare("SELECT * FROM fills").all() as Row[]).map((r): LedgerEvent => ({
      kind: "fill",
      fill: {
        id: String(r.id), orderId: String(r.order_id), symbol: MarketSymbol.parse(r.symbol),
        side: r.side === "buy" ? "buy" : "sell", price: Price.parse(r.price), quantity: Qty.parse(r.quantity),
        fee: Usd.parse(r.fee), liquidity: r.liquidity === "maker" ? "maker" : "taker",
        market: String(r.symbol).endsWith("_PERP") ? "perp" : "spot", closedPnl: null, at: Millis.parse(r.at_ms),
      },
    }));
    const funding = (db.prepare("SELECT * FROM funding").all() as Row[]).map((r): LedgerEvent => ({
      kind: "funding",
      funding: { symbol: MarketSymbol.parse(r.symbol), at: Millis.parse(r.at_ms), amount: Usd.parse(r.amount) },
    }));
    const hist = db.prepare("SELECT SUM(realized) r, SUM(fees) f, SUM(funding) g, SUM(closed_ms IS NULL) open FROM positions").get() as Row;
    const open = db.prepare("SELECT COUNT(*) n FROM positions WHERE closed_ms IS NULL").get() as Row;
    db.close();
    expect(fills.length).toBeGreaterThan(10_000);
    const book = reduceLedger(sortLedger([...fills, ...funding]));
    expect(book.realized).toBeCloseTo(Number(hist.r), 2);
    expect(book.fees).toBeCloseTo(Number(hist.f), 2);
    expect(book.funding).toBeCloseTo(Number(hist.g), 2);
    expect(Object.keys(book.lots).length).toBe(Number(open.n));
  });
});
