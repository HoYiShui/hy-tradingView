import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const valid = {
  BACKPACK_API_URL: "https://api.backpack.exchange",
  BACKPACK_WS_API_URL: "wss://ws.backpack.exchange",
  BACKPACK_API_KEY: "key",
  BACKPACK_API_SECRET: "secret",
};

describe("loadConfig", () => {
  it("applies defaults", () => {
    expect(loadConfig(valid)).toMatchObject({ PORT: 8787, DB_PATH: "data/dashboard.db" });
  });

  it("names the bad variables without echoing any value", () => {
    const secret = "super-secret-value-123";
    let message = "";
    try {
      loadConfig({ ...valid, BACKPACK_API_SECRET: "", BACKPACK_API_URL: secret, BACKPACK_API_KEY: secret });
    } catch (e) {
      message = e instanceof Error ? e.message : "";
    }
    expect(message).toContain("BACKPACK_API_SECRET");
    expect(message).toContain("BACKPACK_API_URL");
    expect(message).not.toContain(secret);
  });
});
