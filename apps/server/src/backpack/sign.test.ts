import { createPublicKey, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { privateKeyFromSeed, signMessage, signingString } from "./sign.js";

describe("signingString", () => {
  it("matches the documented format, sorting params alphabetically", () => {
    expect(
      signingString({
        instruction: "fillHistoryQueryAll",
        params: { symbol: "BTC_USDC_PERP", limit: 5, offset: 0 },
        timestamp: 1614550000000,
        window: 5000,
      }),
    ).toBe("instruction=fillHistoryQueryAll&limit=5&offset=0&symbol=BTC_USDC_PERP&timestamp=1614550000000&window=5000");
  });

  it("signs only instruction, timestamp and window when there are no params", () => {
    expect(signingString({ instruction: "accountQuery", params: {}, timestamp: 1, window: 5000 })).toBe(
      "instruction=accountQuery&timestamp=1&window=5000",
    );
  });
});

describe("signMessage", () => {
  const seed = Buffer.from("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60", "hex");

  it("reproduces the RFC 8032 test vector 1 signature", () => {
    const signature = signMessage(privateKeyFromSeed(seed.toString("base64")), "");
    expect(Buffer.from(signature, "base64").toString("hex")).toBe(
      "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
    );
  });

  it("produces signatures the matching public key verifies", () => {
    const key = privateKeyFromSeed(seed.toString("base64"));
    const message = "instruction=accountQuery&timestamp=1&window=5000";
    const signature = Buffer.from(signMessage(key, message), "base64");
    expect(verify(null, Buffer.from(message), createPublicKey(key), signature)).toBe(true);
  });

  it("rejects a secret that is not a 32 byte seed", () => {
    expect(() => privateKeyFromSeed(Buffer.from("short").toString("base64"))).toThrow(/32 byte/);
  });
});
