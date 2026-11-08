import { Usd, type AccountSnapshot, type Millis, type OpenOrder } from "@hy/types";
import { deriveMetrics } from "../domain.js";
import { STABLE_TOKENS, type AccountMode, type PerpState, type SpotBalance, type SpotState } from "./parse.js";

export type UsdPerUnit = (balance: SpotBalance) => number;

const sum = <T>(xs: readonly T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);

export function buildSnapshot(input: {
  asOf: Millis;
  mode: AccountMode;
  perps: readonly PerpState[];
  spot: SpotState;
  usdPerUnit: UsdPerUnit;
  openOrders: OpenOrder[];
}): AccountSnapshot {
  const { mode, perps, spot, usdPerUnit } = input;
  const spotValue = sum(spot.balances, (b) => b.total * usdPerUnit(b));
  const spotFree = sum(spot.balances, (b) => Math.max(0, b.total - b.hold) * usdPerUnit(b));
  const stableAvailable = sum(spot.balances, (b) =>
    STABLE_TOKENS.has(b.coin) ? (spot.availableAfterMaintenance.get(b.token) ?? 0) : 0,
  );

  // Unified and portfolio margin accounts hold one spot pool whose total already floats with perp
  // unrealized PnL. Adding perp account value on top would count the same margin twice.
  const equity = mode === "pooled" ? spotValue : sum(perps, (p) => p.accountValue) + spotValue;
  const available = mode === "pooled" ? (spot.availableAfterMaintenance.size > 0 ? stableAvailable : spotFree) : sum(perps, (p) => p.withdrawable) + spotFree;

  const positions = perps.flatMap((p) => p.positions);
  const metrics = deriveMetrics(Usd.parse(equity), positions);
  const totalNotional = sum(perps, (p) => p.totalNotional);
  const crossNotional = sum(perps, (p) => p.crossNotional);
  const leverageLimits = perps.flatMap((p) => (p.maxLeverage === null ? [] : [p.maxLeverage]));
  return {
    exchange: "hyperliquid",
    asOf: input.asOf,
    account: {
      equity: Usd.parse(equity),
      availableEquity: Usd.parse(available),
      lockedEquity: Usd.parse(Math.max(0, equity - available)),
      initialMarginFraction: totalNotional > 0 ? sum(perps, (p) => p.totalMarginUsed) / totalNotional : 0,
      maintenanceMarginFraction: crossNotional > 0 ? sum(perps, (p) => p.crossMaintenanceMargin) / crossNotional : 0,
      marginFraction: metrics.grossNotional > 0 && equity > 0 ? equity / metrics.grossNotional : null,
      leverageLimit: leverageLimits.length === 0 ? null : Math.max(...leverageLimits),
      liquidating: false,
    },
    positions,
    openOrders: input.openOrders,
    metrics,
  };
}
