import { describe, expect, it } from "vitest";
import ledger from "../../../../scripts/samples-hyperliquid/userNonFundingLedgerUpdates.json";
import type { Transfer } from "@hy/types";
import { Address } from "./address.js";
import { parseLedgerUpdates } from "./transfers.js";

const SELF = Address.parse(`0x${"0".repeat(39)}1`);
const OTHER = `0x${"0".repeat(40)}`;
const SELF_RAW = SELF;

const update = (delta: Record<string, unknown>, time = 1000) => ({ time, hash: `0x${"0".repeat(64)}`, delta });
const counted = (ts: Transfer[]) => ts.flatMap((t) => (t.status === "counted" ? [t.amount] : []));

describe("hyperliquid ledger updates against a real redacted ledger", () => {
  const parsed = parseLedgerUpdates(ledger, SELF);

  it("counts every deposit, withdrawal and send with the fee inside the signed amount", () => {
    expect(parsed).toHaveLength(8);
    expect(counted(parsed).map((a) => Number(a.toFixed(6)))).toEqual([19.8, -19.8, 48, -48, 188.87, -417.314422, -50.040813, -20]);
  });

  it("nets to the transfers that explain the account's derived starting balance", () => {
    expect(counted(parsed).reduce((s, a) => s + a, 0)).toBeCloseTo(-298.485235, 6);
  });

  it("labels each flow", () => {
    expect(parsed.map((t) => t.flow)).toEqual(["transfer", "withdrawal", "deposit", "withdrawal", "deposit", "transfer", "transfer", "withdrawal"]);
  });

  it("gives every update a distinct id so a resync cannot double count", () => {
    expect(new Set(parsed.map((t) => t.id)).size).toBe(parsed.length);
  });
});

describe("hyperliquid ledger classification", () => {
  it("ignores moves between the spot and perp balances and a send to oneself", () => {
    const rows = [
      update({ type: "accountClassTransfer", usdc: "100.0", toPerp: true }),
      update({ type: "send", user: SELF_RAW, destination: SELF_RAW, token: "USDC", amount: "5", usdcValue: "5", fee: "0", feeToken: "" }),
      update({ type: "cStakingTransfer", token: "HYPE", amount: "1", isDeposit: true }),
    ];
    expect(parseLedgerUpdates(rows, SELF)).toEqual([]);
  });

  it("counts a send by direction and reads the exchange's USD value for a non stable token", () => {
    const rows = [
      update({ type: "spotTransfer", user: OTHER, destination: SELF_RAW, token: "HYPE", amount: "2", usdcValue: "70", fee: "0", feeToken: "HYPE" }, 1),
      update({ type: "spotTransfer", user: SELF_RAW, destination: OTHER, token: "HYPE", amount: "1", usdcValue: "35", fee: "0", feeToken: "HYPE" }, 2),
    ];
    expect(counted(parseLedgerUpdates(rows, SELF))).toEqual([70, -35]);
  });

  it("excludes a send whose fee is in a token with no fixed USD value, and a token with no USD value", () => {
    const rows = [
      update({ type: "spotTransfer", user: SELF_RAW, destination: OTHER, token: "USDC", amount: "10", usdcValue: "10", fee: "0.5", feeToken: "HYPE" }, 1),
      update({ type: "spotTransfer", user: OTHER, destination: SELF_RAW, token: "JUNK", amount: "9", usdcValue: "0", fee: "0", feeToken: "" }, 2),
    ];
    expect(parseLedgerUpdates(rows, SELF).map((t) => [t.status, t.status === "excluded" ? t.reason : null])).toEqual([
      ["excluded", "unpriced"],
      ["excluded", "unpriced"],
    ]);
  });

  it("treats vault and sub-account moves as capital flows and a withdrawn vault share at its net USD", () => {
    const rows = [
      update({ type: "vaultDeposit", vault: OTHER, usdc: "100" }, 1),
      update({ type: "vaultWithdraw", vault: OTHER, user: SELF_RAW, requestedUsd: "120", commission: "2", closingCost: "0", basis: "100", netWithdrawnUsd: "118" }, 2),
      update({ type: "vaultCreate", vault: OTHER, usdc: "100", fee: "100" }, 3),
      update({ type: "subAccountTransfer", user: OTHER, destination: SELF_RAW, usdc: "30" }, 4),
      update({ type: "subAccountTransfer", user: SELF_RAW, destination: OTHER, usdc: "10" }, 5),
    ];
    const out = parseLedgerUpdates(rows, SELF);
    expect(counted(out)).toEqual([-100, 118, -200, 30, -10]);
    expect(out.map((t) => t.flow)).toEqual(["vault", "vault", "vault", "transfer", "transfer"]);
  });

  it("counts a stable reward and excludes a reward in a token with no fixed value", () => {
    const out = parseLedgerUpdates([update({ type: "rewardsClaim", amount: "1.5", token: "USDC" }, 1), update({ type: "rewardsClaim", amount: "3", token: "HYPE" }, 2)], SELF);
    expect(out.map((t) => [t.flow, t.status])).toEqual([["reward", "counted"], ["reward", "excluded"]]);
    expect(counted(out)).toEqual([1.5]);
  });

  it("surfaces an unknown update type as excluded instead of dropping it", () => {
    const [t] = parseLedgerUpdates([update({ type: "someFutureThing", usdc: "1" })], SELF);
    expect(t).toMatchObject({ status: "excluded", reason: "unclassified", asset: "someFutureThing" });
  });

  it("fails loudly when a known update loses a field", () => {
    expect(() => parseLedgerUpdates([update({ type: "deposit" })], SELF)).toThrow();
  });
});
