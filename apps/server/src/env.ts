import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../..");

export type Account = "live" | "test";

export function loadRootEnv(env: NodeJS.ProcessEnv = process.env): { account: Account } {
  const file = resolve(repoRoot, ".env");
  if (existsSync(file)) process.loadEnvFile(file);
  if (env["ACCOUNT"] !== "test") return { account: "live" };
  const key = env["BACKPACK_TEST_API_KEY"];
  const secret = env["BACKPACK_TEST_API_SECRET"];
  if (!key || !secret) throw new Error("ACCOUNT=test needs BACKPACK_TEST_API_KEY and BACKPACK_TEST_API_SECRET in .env");
  env["BACKPACK_API_KEY"] = key;
  env["BACKPACK_API_SECRET"] = secret;
  env["DB_PATH"] ??= "data/test.db";
  env["PORT"] ??= "8788";
  return { account: "test" };
}
