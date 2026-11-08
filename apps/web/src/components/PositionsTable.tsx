import type { Position } from "@hy/types";
import { price, qty, SIGN_MARK, shortSymbol, signedUsd, signOf, usd } from "../lib/format";
import { snapshotOf } from "../lib/status";
import { SIGN_TEXT, cn } from "../lib/utils";
import { useFeedStore } from "../store/feedStore";
import { Flash } from "./Flash";
import { Empty, Panel } from "./Panel";
import { SideBadge } from "./SideBadge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

const NUM = "num text-right";

export function PositionsTable({ className }: { className?: string }) {
  const snapshot = useFeedStore((s) => snapshotOf(s.feed));
  return <PositionsPanel positions={snapshot?.positions ?? []} emptyText={snapshot !== null ? "No open positions" : "Waiting for data"} className={className} />;
}

export function PositionsPanel({ positions, emptyText, className }: { positions: readonly Position[]; emptyText: string; className?: string }) {
  return (
    <Panel title="Positions" className={className}>
      {positions.length === 0 ? (
        <Empty>{emptyText}</Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Symbol</TableHead><TableHead>Side</TableHead>
              {["Size", "Entry", "Mark", "Liq.", "Notional", "Open PnL", "Funding"].map((h) => (
                <TableHead key={h} className="text-right">{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {positions.map((p) => {
              const s = signOf(p.openPnl);
              const f = signOf(p.cumulativeFunding);
              return (
                <TableRow key={p.symbol}>
                  <TableCell>{shortSymbol(p.symbol)}</TableCell>
                  <TableCell><SideBadge side={p.direction} /></TableCell>
                  <TableCell className={NUM}>{qty(p.quantity)}</TableCell>
                  <TableCell className={NUM}>{price(p.entryPrice)}</TableCell>
                  <TableCell className={NUM}><Flash value={price(p.markPrice)} /></TableCell>
                  <TableCell className={NUM}>{p.liquidationPrice === null ? "-" : price(p.liquidationPrice)}</TableCell>
                  <TableCell className={NUM}>{usd(p.notional)}</TableCell>
                  <TableCell className={cn(NUM, SIGN_TEXT[s])}>{SIGN_MARK[s]} <Flash value={signedUsd(p.openPnl)} /></TableCell>
                  <TableCell className={cn(NUM, SIGN_TEXT[f])}>{signedUsd(p.cumulativeFunding)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Panel>
  );
}
