import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import { serve } from "@hono/node-server";
import { createAccountContext, defaultDeps, startAccount } from "./accounts.js";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { loadRootEnv, repoRoot } from "./env.js";

loadRootEnv();

let config;
try {
  config = loadConfig(process.env);
} catch (e) {
  console.error(e instanceof Error ? e.message : "Invalid configuration");
  process.exit(1);
}

const log = (msg: string) => console.error(`[${new Date().toISOString()}] ${msg}`);

const deps = defaultDeps(log);
const contexts = config.accounts.map((account) => createAccountContext(account, deps));
for (const ctx of contexts) startAccount(ctx, log);

const webDist = resolve(repoRoot, "apps/web/dist");
const app = createApp({ registry: contexts, webRoot: existsSync(webDist) ? relative(process.cwd(), webDist) || "." : null });
serve({ fetch: app.fetch, port: config.port }, (info) => log(`listening on :${info.port}`));
