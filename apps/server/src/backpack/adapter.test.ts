import { describe, expect, it } from "vitest";
import deposits from "../../../../scripts/samples-test/deposits.json";
import withdrawals from "../../../../scripts/samples-test/withdrawals.json";
import { Millis } from "@hy/types";
import { createBackpackReader } from "./adapter.js";
import type { BackpackClient } from "./client.js";

function fakeClient() {
  const calls: { path: string; params: Record<string, string | number> }[] = [];
  const client: BackpackClient = {
    async publicGet() {
      throw new Error("unexpected public call");
    },
    async signedGet(_instruction, path, params = {}) {
      calls.push({ path, params: { ...params } });
      if (path.endsWith("/deposits")) return Number(params["offset"]) === 0 ? deposits : [];
      if (path.endsWith("/withdrawals")) return withdrawals;
      throw new Error(`unexpected ${path}`);
    },
  };
  return { client, calls };
}

describe("backpack transfers", () => {
  it("reads deposits and withdrawals from the capital history, from the given time", async () => {
    const { client, calls } = fakeClient();
    const out = await createBackpackReader(client).fetchTransfers({ from: Millis.parse(1_700_000_000_000) });
    expect(out).toHaveLength(deposits.length + withdrawals.length);
    expect(calls.map((c) => c.path)).toEqual(["/wapi/v1/capital/deposits", "/wapi/v1/capital/withdrawals"]);
    expect(calls.every((c) => c.params["from"] === 1_700_000_000_000)).toBe(true);
  });

  it("reads everything on the first sync", async () => {
    const { client, calls } = fakeClient();
    await createBackpackReader(client).fetchTransfers({ from: null });
    expect(calls.every((c) => !("from" in c.params))).toBe(true);
  });
});
