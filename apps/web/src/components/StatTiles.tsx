import { leverageX, percent, SIGN_MARK, SIGN_WORD, signedUsd, signOf, usd } from "../lib/format";
import { snapshotOf } from "../lib/status";
import { cn } from "../lib/utils";
import { useFeedState } from "../hooks/useAccount";
import { Flash } from "./Flash";
import { Card } from "./ui/card";

export function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <Card className="px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div data-testid="tile-value" className={cn("num truncate text-lg font-semibold leading-tight text-foreground", tone)}>
        <Flash value={value} />
      </div>
      <div className="num min-h-[1.4em] truncate text-xs text-muted-foreground">{sub ?? " "}</div>
    </Card>
  );
}

const LABELS = ["Equity", "Open PnL", "Cross leverage", "Available equity", "Locked equity", "Margin fraction"];

export function StatTiles() {
  const snapshot = useFeedState((s) => snapshotOf(s.feed));
  return (
    <section aria-label="Account summary" className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {snapshot === null ? LABELS.map((l) => <Tile key={l} label={l} value="-" />) : <Loaded snapshot={snapshot} />}
    </section>
  );
}

function Loaded({ snapshot }: { snapshot: NonNullable<ReturnType<typeof snapshotOf>> }) {
  const { account, metrics } = snapshot;
  const sign = signOf(metrics.openPnl);
  const pnlTone = { gain: "text-gain", loss: "text-loss", flat: undefined }[sign];
  return (
    <>
      <Tile label="Equity" value={usd(account.equity)} />
      <Tile label="Open PnL" value={`${SIGN_MARK[sign]} ${signedUsd(metrics.openPnl)}`} sub={SIGN_WORD[sign]} tone={pnlTone} />
      <Tile label="Cross leverage" value={leverageX(metrics.leverage)} sub={`limit ${account.leverageLimit}x · gross ${usd(metrics.grossNotional)}`} />
      <Tile label="Available equity" value={usd(account.availableEquity)} />
      <Tile label="Locked equity" value={usd(account.lockedEquity)} />
      <Tile
        label="Margin fraction"
        value={percent(account.marginFraction)}
        sub={account.liquidating ? "LIQUIDATING" : `maint ${percent(account.maintenanceMarginFraction)}`}
        tone={account.liquidating ? "text-loss" : undefined}
      />
    </>
  );
}
