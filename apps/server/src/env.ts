import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../..");

export function loadRootEnv(): void {
  const file = resolve(repoRoot, ".env");
  if (existsSync(file)) process.loadEnvFile(file);
}
