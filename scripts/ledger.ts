import type { DatabaseSync } from "node:sqlite";
import { MarketSymbol, Millis, Price, Qty, Usd, type LedgerEvent } from "../packages/types/src/index.js";

type Row = Record<string, string | number | null>;

export function loadLedger(db: DatabaseSync): { fills: LedgerEvent[]; funding: LedgerEvent[] } {
  const fills = (db.prepare("SELECT * FROM fills ORDER BY at_ms, rowid").all() as Row[]).map((r): LedgerEvent => ({
    kind: "fill",
    fill: {
      id: String(r["id"]), orderId: String(r["order_id"]), symbol: MarketSymbol.parse(r["symbol"]),
      side: r["side"] === "buy" ? "buy" : "sell", price: Price.parse(r["price"]), quantity: Qty.parse(r["quantity"]),
      fee: Usd.parse(r["fee"]), liquidity: r["liquidity"] === "maker" ? "maker" : "taker",
      market: r["market"] === "spot" ? "spot" : "perp",
      closedPnl: r["closed_pnl"] === null || r["closed_pnl"] === undefined ? null : Usd.parse(r["closed_pnl"]),
      at: Millis.parse(r["at_ms"]),
    },
  }));
  const funding = (db.prepare("SELECT * FROM funding").all() as Row[]).map((r): LedgerEvent => ({
    kind: "funding",
    funding: { symbol: MarketSymbol.parse(r["symbol"]), at: Millis.parse(r["at_ms"]), amount: Usd.parse(r["amount"]) },
  }));
  return { fills, funding };
}
