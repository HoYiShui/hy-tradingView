import type { AccountSnapshot, AccountState, Millis, OpenOrder, Position } from "@hy/types";
import { Usd } from "@hy/types";
import { deriveMetrics } from "../domain.js";
import type { AccountParts } from "./parse.js";

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
