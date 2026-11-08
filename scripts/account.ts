import { findAccount, loadConfig } from "../apps/server/src/config.js";
import { loadRootEnv } from "../apps/server/src/env.js";
import { directFor } from "./direct/index.js";

export function loadAccount(id: string | undefined) {
  loadRootEnv();
  const config = loadConfig(process.env);
  if (id === undefined) throw new Error(`Pass an account id. Configured: ${config.accounts.map((a) => a.id).join(", ")}`);
  const account = findAccount(config, id);
  return { config, account, direct: directFor(account.credentials) };
}
