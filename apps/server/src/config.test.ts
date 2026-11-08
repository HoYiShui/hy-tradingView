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
    expect(findAccount(c, "live").credentials.apiKey).toBe("key");
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
    expect(c.accounts.map((a) => a.id)).toEqual(["live", "sandbox"]);
    expect(c.accounts.some((a) => a.surfaces.includes("dashboard"))).toBe(true);
  });
});
