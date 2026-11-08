import type { AccountMetrics, Position } from "@hy/types";
import { Usd } from "@hy/types";

export function deriveMetrics(equity: Usd, positions: readonly Position[]): AccountMetrics {
  const grossNotional = positions.reduce((sum, p) => sum + p.notional, 0);
  const netNotional = positions.reduce((sum, p) => sum + (p.direction === "long" ? p.notional : -p.notional), 0);
  const openPnl = positions.reduce((sum, p) => sum + p.openPnl, 0);
  return {
    grossNotional: Usd.parse(grossNotional),
    netNotional: Usd.parse(netNotional),
    leverage: equity > 0 ? grossNotional / equity : null,
    openPnl: Usd.parse(openPnl),
  };
}
