import { describe, expect, it } from "vitest";
import { AccountInfo } from "@hy/types";
import { accountsOn, pickAccount, withAccountParam } from "./accounts";

const info = (id: string, surfaces: string[]) => AccountInfo.parse({ id, label: id, exchange: "backpack", surfaces, chartSymbol: "BTC_USDC_PERP", intervals: ["15m", "1h"], history: { candleDepthBars: null, fillDepth: null } });
const all = [info("live", ["dashboard"]), info("both", ["dashboard", "replay"]), info("test", ["replay"])];

describe("accounts", () => {
  it("lists only the accounts on a surface", () => {
    expect(accountsOn(all, "dashboard").map((a) => a.id)).toEqual(["live", "both"]);
    expect(accountsOn(all, "replay").map((a) => a.id)).toEqual(["both", "test"]);
  });

  it("picks the requested account when it is on the surface, else the first", () => {
    expect(pickAccount(all, "dashboard", "both")?.id).toBe("both");
    expect(pickAccount(all, "dashboard", "test")?.id).toBe("live");
    expect(pickAccount(all, "dashboard", null)?.id).toBe("live");
    expect(pickAccount(all, "replay", "nope")?.id).toBe("both");
  });

  it("returns null when no account is on the surface", () => {
    expect(pickAccount([info("live", ["dashboard"])], "replay", null)).toBeNull();
  });

  it("sets the account param and keeps the others", () => {
    expect(withAccountParam("?interval=1h&account=live", "test")).toBe("?interval=1h&account=test");
    expect(withAccountParam("", "live")).toBe("?account=live");
  });
});
