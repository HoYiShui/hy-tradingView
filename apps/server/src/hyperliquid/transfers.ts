import { z } from "zod";
import { Millis, Usd, type Transfer, type TransferFlow } from "@hy/types";
import type { Address } from "./address.js";
import { RawLedgerDeltas, RawLedgerUpdate } from "./raw.js";
import { STABLE_TOKENS } from "./parse.js";

const INTERNAL_MOVES: ReadonlySet<string> = new Set(["accountClassTransfer", "cStakingTransfer", "liquidation"]);

type Valued = { flow: TransferFlow; asset: string; usd: number | null };

const stableOr = (token: string, amount: number): number | null => (STABLE_TOKENS.has(token) ? amount : null);
const feeIn = (token: string, fee: number): number | null => (fee === 0 || token === "" || STABLE_TOKENS.has(token) ? fee : null);

function direction(update: { user: string; destination: string }, self: string): "in" | "out" | "internal" {
  const from = update.user.toLowerCase() === self;
  const to = update.destination.toLowerCase() === self;
  return from && to ? "internal" : to ? "in" : "out";
}

function moved(dir: "in" | "out", amount: number, fee: number | null): number | null {
  if (dir === "in") return amount;
  return fee === null ? null : -(amount + fee);
}

type Classified = Valued | "internal";

function classify(type: string, delta: Record<string, unknown>, self: string): Classified | null {
  switch (type) {
    case "deposit": {
      const d = RawLedgerDeltas.deposit.parse(delta);
      return { flow: "deposit", asset: "USDC", usd: d.usdc };
    }
    case "withdraw": {
      const d = RawLedgerDeltas.withdraw.parse(delta);
      return { flow: "withdrawal", asset: "USDC", usd: -(d.usdc + d.fee) };
    }
    case "send":
    case "spotTransfer": {
      const d = RawLedgerDeltas[type].parse(delta);
      const dir = direction(d, self);
      if (dir === "internal") return "internal";
      const priced = d.usdcValue > 0 || STABLE_TOKENS.has(d.token) ? d.usdcValue : null;
      return { flow: "transfer", asset: d.token, usd: priced === null ? null : moved(dir, priced, feeIn(d.feeToken, d.fee)) };
    }
    case "subAccountTransfer": {
      const d = RawLedgerDeltas.subAccountTransfer.parse(delta);
      const dir = direction(d, self);
      return dir === "internal" ? "internal" : { flow: "transfer", asset: "USDC", usd: moved(dir, d.usdc, 0) };
    }
    case "vaultDeposit":
      return { flow: "vault", asset: "USDC", usd: -RawLedgerDeltas.vaultDeposit.parse(delta).usdc };
    case "vaultWithdraw":
      return { flow: "vault", asset: "USDC", usd: RawLedgerDeltas.vaultWithdraw.parse(delta).netWithdrawnUsd };
    case "vaultCreate": {
      const d = RawLedgerDeltas.vaultCreate.parse(delta);
      return { flow: "vault", asset: "USDC", usd: -(d.usdc + d.fee) };
    }
    case "vaultDistribution":
      return { flow: "vault", asset: "USDC", usd: RawLedgerDeltas.vaultDistribution.parse(delta).usdc };
    case "rewardsClaim": {
      const d = RawLedgerDeltas.rewardsClaim.parse(delta);
      return { flow: "reward", asset: d.token, usd: stableOr(d.token, d.amount) };
    }
    default:
      return null;
  }
}

export function parseLedgerUpdates(input: unknown, address: Address): Transfer[] {
  const self = address.toLowerCase();
  return z
    .array(z.unknown())
    .parse(input)
    .flatMap((x): Transfer[] => {
      const raw = RawLedgerUpdate.parse(x);
      const { type } = raw.delta;
      if (INTERNAL_MOVES.has(type)) return [];
      const base = { id: `${raw.hash}:${type}:${raw.time}`, at: Millis.parse(raw.time) };
      const classified = classify(type, raw.delta, self);
      if (classified === "internal") return [];
      if (classified === null) return [{ ...base, asset: type, flow: "transfer", status: "excluded", reason: "unclassified" }];
      const { flow, asset, usd } = classified;
      if (usd === null) return [{ ...base, asset, flow, status: "excluded", reason: "unpriced" }];
      return [{ ...base, asset, flow, status: "counted", amount: Usd.parse(usd) }];
    });
}
