import { createPrivateKey, sign, type KeyObject } from "node:crypto";

export const READ_INSTRUCTIONS = [
  "accountQuery",
  "collateralQuery",
  "positionQuery",
  "orderQueryAll",
  "orderHistoryQueryAll",
  "fillHistoryQueryAll",
  "fundingHistoryQueryAll",
  "positionHistoryQueryAll",
] as const;
export type ReadInstruction = (typeof READ_INSTRUCTIONS)[number];

export type QueryParams = Readonly<Record<string, string | number>>;

const PKCS8_ED25519_SEED_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

export function privateKeyFromSeed(seedBase64: string): KeyObject {
  const seed = Buffer.from(seedBase64, "base64");
  if (seed.length !== 32) throw new Error("API secret must decode to a 32 byte ED25519 seed");
  return createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_SEED_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
}

export function signingString(input: {
  instruction: ReadInstruction;
  params: QueryParams;
  timestamp: number;
  window: number;
}): string {
  const sorted = Object.entries(input.params)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`);
  return [`instruction=${input.instruction}`, ...sorted, `timestamp=${input.timestamp}`, `window=${input.window}`].join("&");
}

export function signMessage(key: KeyObject, message: string): string {
  return sign(null, Buffer.from(message), key).toString("base64");
}
