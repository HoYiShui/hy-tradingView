import { describe, expect, it } from "vitest";
import deposits from "../../../../scripts/samples-test/deposits.json";
import withdrawals from "../../../../scripts/samples-test/withdrawals.json";
import { parseDeposits, parseWithdrawals } from "./parse.js";

const deposit = (over: Record<string, unknown>) => ({ ...deposits[0], ...over });
const withdrawal = (over: Record<string, unknown>) => ({ ...withdrawals[0], ...over });

describe("backpack deposits", () => {
  const parsed = parseDeposits(deposits);

  it("counts stablecoin deposits at par and tags a sub-account move as a transfer", () => {
    const usdc = deposits.flatMap((d, i) => (d.symbol === "USDC" && d.status === "confirmed" ? [[d, parsed[i]] as const] : []));
    expect(usdc.length).toBeGreaterThan(1);
    for (const [raw, t] of usdc) {
      expect(t).toMatchObject({ status: "counted", amount: Number(raw.quantity), flow: raw.source === "internal" ? "transfer" : "deposit" });
    }
  });

  it("excludes a deposit of any other asset as unpriced instead of dropping it", () => {
    const other = parsed.filter((t) => t.asset !== "USDC" && t.asset !== "USDT");
    expect(other.length).toBeGreaterThan(0);
    expect(other.every((t) => t.status === "excluded" && t.reason === "unpriced")).toBe(true);
    expect(parsed).toHaveLength(deposits.length);
  });

  it("keeps an unsettled deposit visible and omits one that never moved funds", () => {
    const out = parseDeposits([deposit({ id: 1, status: "pending" }), deposit({ id: 2, status: "cancelled" }), deposit({ id: 3, status: "confirmed" })]);
    expect(out.map((t) => [t.id, t.status])).toEqual([["deposit:1", "excluded"], ["deposit:3", "counted"]]);
    expect(out[0]).toMatchObject({ reason: "unsettled" });
  });

  it("reads the timestamp as UTC", () => {
    expect(parseDeposits([deposit({ createdAt: "2026-11-06T12:07:15.556" })])[0]?.at).toBe(Date.UTC(2026, 10, 6, 12, 7, 15, 556));
  });
});

describe("backpack withdrawals", () => {
  const parsed = parseWithdrawals(withdrawals);

  it("charges the fee on top of the quantity as part of the signed amount", () => {
    const [t] = parseWithdrawals([withdrawal({ symbol: "USDC", quantity: "562.911792", fee: "0.5", isInternal: false })]);
    expect(t).toMatchObject({ status: "counted", flow: "withdrawal", amount: -563.411792 });
  });

  it("tags an internal withdrawal as a transfer out", () => {
    const [t] = parseWithdrawals([withdrawal({ symbol: "USDC", quantity: "1000", fee: "0", isInternal: true })]);
    expect(t).toMatchObject({ status: "counted", flow: "transfer", amount: -1000 });
  });

  it("excludes non stable assets and gives every withdrawal a distinct id", () => {
    expect(parsed.filter((t) => t.status === "excluded").every((t) => t.status === "excluded" && t.reason === "unpriced")).toBe(true);
    expect(new Set(parsed.map((t) => t.id)).size).toBe(withdrawals.length);
  });
});
