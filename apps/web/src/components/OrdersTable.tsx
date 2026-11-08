import type { OpenOrder } from "@hy/types";
import { price, qty, shortSymbol, triggerSizeLabel, utcTime } from "../lib/format";
import { snapshotOf } from "../lib/status";
import { cn } from "../lib/utils";
import { useFeedState } from "../hooks/useAccount";
import { Empty, Panel } from "./Panel";
import { SideBadge } from "./SideBadge";
import { Badge } from "./ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

const NUM = "num text-right";

function OrderRow({ o }: { o: OpenOrder }) {
  const flags = o.reduceOnly ? "reduce-only" : o.kind === "limit" && o.postOnly ? "post-only" : "";
  const common = (
    <>
      <TableCell>{shortSymbol(o.symbol)}</TableCell>
      <TableCell><Badge className={cn(o.kind === "trigger" ? "text-warn" : "text-secondary-foreground")}>{o.kind === "limit" ? "Limit" : "Trigger"}</Badge></TableCell>
      <TableCell><SideBadge side={o.side} /></TableCell>
    </>
  );
  const tail = (
    <>
      <TableCell className="text-muted-foreground">{flags}</TableCell>
      <TableCell className={cn(NUM, "text-muted-foreground")}>{utcTime(o.createdAt)}</TableCell>
    </>
  );
  switch (o.kind) {
    case "limit":
      return (
        <TableRow>
          {common}
          <TableCell className={NUM}>{price(o.price)}</TableCell>
          <TableCell className={NUM}>
            {qty(o.quantity)}
            {o.executedQuantity > 0 && <span className="text-muted-foreground"> ({qty(o.executedQuantity)} filled)</span>}
          </TableCell>
          {tail}
        </TableRow>
      );
    case "trigger":
      return (
        <TableRow>
          {common}
          <TableCell className={NUM}>
            <span className="text-muted-foreground">at </span>{price(o.triggerPrice)}
            <span className="text-muted-foreground"> → {o.execution}</span>
          </TableCell>
          <TableCell className={NUM}>{triggerSizeLabel(o.size)}</TableCell>
          {tail}
        </TableRow>
      );
    default: {
      const _exhaustive: never = o;
      return _exhaustive;
    }
  }
}

export function OrdersTable({ className }: { className?: string }) {
  const snapshot = useFeedState((s) => snapshotOf(s.feed));
  const orders = snapshot?.openOrders ?? [];
  return (
    <Panel title="Open orders" className={className}>
      {orders.length === 0 ? (
        <Empty>{snapshot !== null ? "No open orders" : "Waiting for data"}</Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Symbol</TableHead><TableHead>Type</TableHead><TableHead>Side</TableHead>
              <TableHead className="text-right">Price</TableHead><TableHead className="text-right">Qty</TableHead>
              <TableHead>Flags</TableHead><TableHead className="text-right">Created (UTC)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>{orders.map((o) => <OrderRow key={o.id} o={o} />)}</TableBody>
        </Table>
      )}
    </Panel>
  );
}
