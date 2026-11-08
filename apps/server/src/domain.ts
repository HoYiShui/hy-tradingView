import type { AccountMetrics, AccountSnapshot, AccountState, Millis, OpenOrder, Position } from "@hy/types";
import { Usd } from "@hy/types";
import type { AccountParts } from "./backpack/parse.js";

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

export function buildAccountState({ account, collateral }: AccountParts): AccountState {
  return {
    equity: Usd.parse(collateral.netEquity),
    availableEquity: Usd.parse(collateral.netEquityAvailable),
    lockedEquity: Usd.parse(collateral.netEquityLocked),
    initialMarginFraction: collateral.imf,
    maintenanceMarginFraction: collateral.mmf,
    marginFraction: collateral.marginFraction,
    leverageLimit: account.leverageLimit,
    liquidating: account.liquidating,
  };
}

export function buildSnapshot(input: {
  asOf: Millis;
  parts: AccountParts;
  positions: Position[];
  openOrders: OpenOrder[];
}): AccountSnapshot {
  const account = buildAccountState(input.parts);
  return {
    exchange: "backpack",
    asOf: input.asOf,
    account,
    positions: input.positions,
    openOrders: input.openOrders,
    metrics: deriveMetrics(account.equity, input.positions),
  };
}
