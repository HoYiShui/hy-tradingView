import { findAccount, loadConfig } from "../apps/server/src/config.js";
import { loadRootEnv } from "../apps/server/src/env.js";
import { createBackpackClient } from "../apps/server/src/backpack/client.js";

export function loadAccount(id: string | undefined) {
  loadRootEnv();
  const config = loadConfig(process.env);
  if (id === undefined) throw new Error(`Pass an account id. Configured: ${config.accounts.map((a) => a.id).join(", ")}`);
  const account = findAccount(config, id);
  const { apiUrl, apiKey, apiSecret } = account.credentials;
  return { config, account, client: createBackpackClient({ baseUrl: apiUrl, apiKey, apiSecret }) };
}
