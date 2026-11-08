import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { describe, expect, it } from "vitest";
import { findAccount, loadConfig } from "./config.js";

const valid = {
  ACCOUNTS: "live,replaytest",
  ACCOUNT_LIVE_EXCHANGE: "backpack",
  ACCOUNT_LIVE_LABEL: "Live",
  ACCOUNT_LIVE_API_KEY: "key",
  ACCOUNT_LIVE_API_SECRET: "secret",
  ACCOUNT_LIVE_SURFACES: "dashboard",
  ACCOUNT_REPLAYTEST_EXCHANGE: "backpack",
  ACCOUNT_REPLAYTEST_LABEL: "Test",
  ACCOUNT_REPLAYTEST_API_KEY: "tkey",
  ACCOUNT_REPLAYTEST_API_SECRET: "tsecret",
  ACCOUNT_REPLAYTEST_SURFACES: "replay",
};

const message = (env: NodeJS.ProcessEnv): string => {
  try {
    loadConfig(env);
  } catch (e) {
    return e instanceof Error ? e.message : "";
  }
  return "";
};

describe("loadConfig", () => {
  it("builds each account with its own database, label and surfaces", () => {
    const c = loadConfig(valid);
    expect(c.port).toBe(8787);
    expect(c.accounts.map((a) => [a.id, a.label, a.surfaces, a.dbPath])).toEqual([
      ["live", "Live", ["dashboard"], "data/live.db"],
      ["replaytest", "Test", ["replay"], "data/replaytest.db"],
    ]);
    expect(c.accounts[1]?.credentials).toEqual({ exchange: "backpack", apiUrl: "https://api.backpack.exchange", apiKey: "tkey", apiSecret: "tsecret" });
  });

  it("accepts an account on both surfaces", () => {
    const c = loadConfig({ ...valid, ACCOUNT_REPLAYTEST_SURFACES: "dashboard, replay" });
    expect(findAccount(c, "replaytest").surfaces).toEqual(["dashboard", "replay"]);
  });

  it("looks accounts up by id and names the configured ones on a miss", () => {
    const c = loadConfig(valid);
    expect(findAccount(c, "live").credentials).toMatchObject({ exchange: "backpack", apiKey: "key" });
    expect(() => findAccount(c, "nope")).toThrow("live, replaytest");
  });

  it("rejects duplicate ids", () => {
    expect(message({ ...valid, ACCOUNTS: "live,live,replaytest" })).toContain("ACCOUNTS");
  });

  it("rejects an unknown exchange by variable name", () => {
    expect(message({ ...valid, ACCOUNT_LIVE_EXCHANGE: "kraken" })).toContain("ACCOUNT_LIVE_EXCHANGE");
  });

  it("names every missing or bad variable without echoing any value", () => {
    const secret = "super-secret-value-123";
    const m = message({
      ...valid,
      ACCOUNT_LIVE_API_SECRET: "",
      ACCOUNT_LIVE_SURFACES: secret,
      ACCOUNT_REPLAYTEST_API_KEY: undefined,
      ACCOUNT_REPLAYTEST_LABEL: secret,
      BACKPACK_API_URL: secret,
    });
    for (const name of ["ACCOUNT_LIVE_API_SECRET", "ACCOUNT_LIVE_SURFACES", "ACCOUNT_REPLAYTEST_API_KEY", "BACKPACK_API_URL"]) expect(m).toContain(name);
    expect(m).toContain(".env.example");
    expect(m).not.toContain(secret);
    expect(m).not.toContain("tsecret");
  });

  it("rejects an unknown surface and an empty surface list", () => {
    expect(message({ ...valid, ACCOUNT_LIVE_SURFACES: "dashboard,admin" })).toContain("ACCOUNT_LIVE_SURFACES");
    expect(message({ ...valid, ACCOUNT_LIVE_SURFACES: "" })).toContain("ACCOUNT_LIVE_SURFACES");
  });

  it("requires at least one account and one dashboard account", () => {
    expect(message({})).toContain("ACCOUNTS");
    expect(message({ ...valid, ACCOUNT_LIVE_SURFACES: "replay" })).toContain("ACCOUNTS");
  });

  it("rejects an account id that is not lowercase letters and digits", () => {
    expect(message({ ...valid, ACCOUNTS: "Live" })).toContain("ACCOUNTS");
  });

  it("parses .env.example", () => {
    const example = parseEnv(readFileSync(new URL("../../../.env.example", import.meta.url), "utf8"));
    const c = loadConfig(example);
    expect(c.accounts.map((a) => a.id)).toEqual(["live", "sandbox", "perp"]);
    expect(c.accounts.some((a) => a.surfaces.includes("dashboard"))).toBe(true);
    expect(findAccount(c, "perp").credentials).toMatchObject({ exchange: "hyperliquid", address: "0x0000000000000000000000000000000000000000" });
    expect(c.accounts.map((a) => a.chart)).toEqual([{ kind: "default" }, { kind: "market", symbol: "SOL_USDC_PERP" }, { kind: "most-traded" }]);
  });
});

describe("hyperliquid accounts", () => {
  const ADDRESS = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
  const withHl = (over: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
    ...valid,
    ACCOUNTS: "live,hl",
    ACCOUNT_HL_EXCHANGE: "hyperliquid",
    ACCOUNT_HL_LABEL: "Hyperliquid",
    ACCOUNT_HL_ADDRESS: ADDRESS,
    ACCOUNT_HL_SURFACES: "dashboard,replay",
    ...over,
  });

  it("builds a hyperliquid account from an address alone beside a backpack account", () => {
    const c = loadConfig(withHl());
    expect(findAccount(c, "hl").credentials).toEqual({ exchange: "hyperliquid", apiUrl: "https://api.hyperliquid.xyz", address: ADDRESS });
    expect(findAccount(c, "hl").dbPath).toBe("data/hl.db");
    expect(findAccount(c, "live").credentials.exchange).toBe("backpack");
  });

  it("accepts an all lowercase address", () => {
    expect(message(withHl({ ACCOUNT_HL_ADDRESS: ADDRESS.toLowerCase() }))).toBe("");
  });

  it("names a missing address", () => {
    expect(message(withHl({ ACCOUNT_HL_ADDRESS: undefined }))).toContain("ACCOUNT_HL_ADDRESS");
  });

  it("rejects a bad format and a bad checksum without echoing the value", () => {
    const badChecksum = ADDRESS.replace("5aAe", "5aae");
    for (const bad of ["0x123", "not-an-address", ADDRESS.slice(2), badChecksum]) {
      const m = message(withHl({ ACCOUNT_HL_ADDRESS: bad }));
      expect(m).toContain("ACCOUNT_HL_ADDRESS");
      expect(m).not.toContain(bad);
    }
  });

  it("rejects a private key variable by name and backpack credentials on a hyperliquid account", () => {
    const key = "0x" + "ab".repeat(32);
    const m = message(withHl({ ACCOUNT_HL_PRIVATE_KEY: key }));
    expect(m).toContain("ACCOUNT_HL_PRIVATE_KEY");
    expect(m).not.toContain(key);
    expect(message(withHl({ ACCOUNT_HL_API_KEY: "k" }))).toContain("ACCOUNT_HL_API_KEY");
  });

  it("rejects an address on a backpack account", () => {
    expect(message({ ...valid, ACCOUNT_LIVE_ADDRESS: ADDRESS })).toContain("ACCOUNT_LIVE_ADDRESS");
  });
});

describe("chart market", () => {
  const withHl = (chart: string | undefined): NodeJS.ProcessEnv => ({
    ...valid,
    ACCOUNTS: "live,hl",
    ACCOUNT_HL_EXCHANGE: "hyperliquid",
    ACCOUNT_HL_LABEL: "Hyperliquid",
    ACCOUNT_HL_ADDRESS: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
    ACCOUNT_HL_SURFACES: "replay",
    ACCOUNT_HL_CHART: chart,
  });
  const chartOf = (env: NodeJS.ProcessEnv, id: string) => findAccount(loadConfig(env), id).chart;

  it("defaults to the adapter's market when unset", () => {
    expect(chartOf(valid, "live")).toEqual({ kind: "default" });
    expect(chartOf(withHl(undefined), "hl")).toEqual({ kind: "default" });
  });

  it("accepts most-traded on either exchange", () => {
    expect(chartOf({ ...valid, ACCOUNT_LIVE_CHART: "most-traded" }, "live")).toEqual({ kind: "most-traded" });
    expect(chartOf(withHl("most-traded"), "hl")).toEqual({ kind: "most-traded" });
  });

  it("accepts a market in each exchange's own naming", () => {
    expect(chartOf({ ...valid, ACCOUNT_LIVE_CHART: "SOL_USDC_PERP" }, "live")).toEqual({ kind: "market", symbol: "SOL_USDC_PERP" });
    expect(chartOf(withHl("SOL"), "hl")).toEqual({ kind: "market", symbol: "SOL" });
    expect(chartOf(withHl("xyz:GOLD"), "hl")).toEqual({ kind: "market", symbol: "xyz:GOLD" });
    expect(chartOf(withHl("kPEPE"), "hl")).toEqual({ kind: "market", symbol: "kPEPE" });
  });

  it("rejects the other exchange's naming, spot markets, blanks and junk, naming the variable but not the value", () => {
    const cases: [NodeJS.ProcessEnv, string][] = [
      [{ ...valid, ACCOUNT_LIVE_CHART: "SOL" }, "ACCOUNT_LIVE_CHART"],
      [{ ...valid, ACCOUNT_LIVE_CHART: "SOL_USDC" }, "ACCOUNT_LIVE_CHART"],
      [{ ...valid, ACCOUNT_LIVE_CHART: "sol_usdc_perp" }, "ACCOUNT_LIVE_CHART"],
      [{ ...valid, ACCOUNT_LIVE_CHART: "most-traded " }, "ACCOUNT_LIVE_CHART"],
      [{ ...valid, ACCOUNT_LIVE_CHART: "" }, "ACCOUNT_LIVE_CHART"],
      [withHl("SOL_USDC_PERP"), "ACCOUNT_HL_CHART"],
      [withHl("@107"), "ACCOUNT_HL_CHART"],
      [withHl("BTC/USDC"), "ACCOUNT_HL_CHART"],
      [withHl("Most-Traded"), "ACCOUNT_HL_CHART"],
    ];
    for (const [env, name] of cases) {
      const m = message(env);
      expect(m).toContain(name);
      for (const v of [env["ACCOUNT_LIVE_CHART"], env["ACCOUNT_HL_CHART"]]) if (v) expect(m).not.toContain(v);
    }
  });
});
