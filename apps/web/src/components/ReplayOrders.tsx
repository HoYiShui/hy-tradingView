import type { OrderSpan } from "@hy/types";
import { useSymbolLabel } from "../hooks/useAccount";
import { price, qty, utcTime } from "../lib/format";
import { Empty, Panel } from "./Panel";
import { SideBadge } from "./SideBadge";
import { Badge } from "./ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

const MAX_ROWS = 40;

export function ReplayOrders({ orders }: { orders: readonly OrderSpan[] }) {
  const label = useSymbolLabel();
  const approx = orders.filter((o) => o.estimated).length;
  return (
    <Panel
      title="Open orders (approximate)"
      aside={<span className="text-xs text-muted-foreground">{orders.length} open{approx > 0 ? `, ${approx} with estimated close` : ""}</span>}
    >
      {orders.length === 0 ? (
        <Empty>No open orders at this time</Empty>
      ) : (
        <Table containerClassName="max-h-56 overflow-y-auto">
          <TableHeader>
            <TableRow>
              <TableHead>Symbol</TableHead><TableHead>Type</TableHead><TableHead>Side</TableHead>
              <TableHead className="text-right">Price</TableHead><TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Created (UTC)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.slice(0, MAX_ROWS).map((o) => (
              <TableRow key={`${o.symbol}:${o.from}:${o.price}:${o.side}`}>
                <TableCell>{label(o.symbol)}</TableCell>
                <TableCell><Badge className={o.kind === "trigger" ? "text-warn" : "text-secondary-foreground"}>{o.kind === "limit" ? "Limit" : "Trigger"}</Badge></TableCell>
                <TableCell><SideBadge side={o.side} /></TableCell>
                <TableCell className="num text-right">{price(o.price)}</TableCell>
                <TableCell className="num text-right">{o.quantity > 0 ? qty(o.quantity) : "-"}</TableCell>
                <TableCell className="num text-right text-muted-foreground">{utcTime(o.from)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <p className="mt-1 text-xs text-muted-foreground">
        Order history keeps only the final state. An order is shown open from creation to its last fill. A cancelled order has no recorded close time, so it stays open until the next order on the same market and side, capped at 6 hours.
      </p>
    </Panel>
  );
}
