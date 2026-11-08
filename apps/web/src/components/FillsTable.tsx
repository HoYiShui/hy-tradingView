import type { Fill } from "@hy/types";
import { price, qty, shortSymbol, usd, utcTime } from "../lib/format";
import { Empty, Panel } from "./Panel";
import { SideBadge } from "./SideBadge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

const NUM = "num text-right";

export function FillsTable({ fills, loaded, error, className }: { fills: readonly Fill[]; loaded: boolean; error: string | null; className?: string }) {
  return (
    <Panel title="Fills" className={className} aside={fills.length > 0 ? <span className="text-xs text-muted-foreground">{fills.length} latest</span> : null}>
      {fills.length === 0 ? (
        <Empty>{error !== null ? `Could not load fills (${error})` : loaded ? "No fills yet" : "Loading fills"}</Empty>
      ) : (
        <Table containerClassName="max-h-80 overflow-y-auto">
          <TableHeader>
            <TableRow>
              <TableHead>Time (UTC)</TableHead><TableHead>Symbol</TableHead><TableHead>Side</TableHead>
              <TableHead className="text-right">Price</TableHead><TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Fee</TableHead><TableHead>Liquidity</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {fills.map((f) => (
              <TableRow key={f.id}>
                <TableCell className={`${NUM} text-left text-muted-foreground`}>{utcTime(f.at)}</TableCell>
                <TableCell>{shortSymbol(f.symbol)}</TableCell>
                <TableCell><SideBadge side={f.side} /></TableCell>
                <TableCell className={NUM}>{price(f.price)}</TableCell>
                <TableCell className={NUM}>{qty(f.quantity)}</TableCell>
                <TableCell className={NUM}>{usd(f.fee)}</TableCell>
                <TableCell>{f.liquidity}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Panel>
  );
}
