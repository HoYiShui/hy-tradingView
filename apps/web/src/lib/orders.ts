import type { OpenOrder, Position } from "@hy/types";
import { price, qty, triggerSizeLabel } from "./format";
import { COLOR } from "./theme";

export interface PriceLineSpec {
  key: string;
  price: number;
  color: string;
  style: "solid" | "dotted" | "dashed";
  title: string;
}

function orderLine(o: OpenOrder): PriceLineSpec {
  const side = o.side === "buy" ? "BUY" : "SELL";
  const color = o.side === "buy" ? COLOR.up : COLOR.down;
  switch (o.kind) {
    case "limit":
      return {
        key: `order:${o.id}`,
        price: o.price,
        color,
        style: "dashed",
        title: `${side} limit ${qty(o.quantity - o.executedQuantity)}`,
      };
    case "trigger":
      return {
        key: `order:${o.id}`,
        price: o.triggerPrice,
        color,
        style: "dotted",
        title: `${side} trigger ${o.execution} ${triggerSizeLabel(o.size)}`,
      };
    default: {
      const _exhaustive: never = o;
      return _exhaustive;
    }
  }
}

export function buildPriceLines(
  orders: readonly OpenOrder[],
  positions: readonly Position[],
  symbol: string,
): PriceLineSpec[] {
  const lines: PriceLineSpec[] = [];
  for (const p of positions) {
    if (p.symbol !== symbol) continue;
    lines.push({
      key: `entry:${p.symbol}`,
      price: p.entryPrice,
      color: COLOR.accent,
      style: "solid",
      title: `${p.direction.toUpperCase()} entry ${qty(p.quantity)} @ ${price(p.entryPrice)}`,
    });
    if (p.liquidationPrice !== null) {
      lines.push({ key: `liq:${p.symbol}`, price: p.liquidationPrice, color: COLOR.textSecondary, style: "solid", title: "LIQ" });
    }
  }
  for (const o of orders) if (o.symbol === symbol) lines.push(orderLine(o));
  return lines;
}
