import { z } from "zod";
import { Surface } from "@hy/types";
import { Address } from "./hyperliquid/address.js";

const Id = z.string().regex(/^[a-z][a-z0-9]{0,23}$/);

const Surfaces = z
  .string()
  .transform((s) => s.split(",").map((x) => x.trim()))
  .pipe(z.array(Surface).min(1))
  .refine((xs) => new Set(xs).size === xs.length);

const Shared = { LABEL: z.string().min(1), SURFACES: Surfaces };

const BackpackEnv = z.strictObject({
  EXCHANGE: z.literal("backpack"),
  API_KEY: z.string().min(1),
  API_SECRET: z.string().min(1),
  ...Shared,
});

const HyperliquidEnv = z.strictObject({
  EXCHANGE: z.literal("hyperliquid"),
  ADDRESS: Address,
  ...Shared,
});

const AccountEnv = z.discriminatedUnion("EXCHANGE", [BackpackEnv, HyperliquidEnv]);

const ServerEnv = z.object({
  ACCOUNTS: z
    .string()
    .transform((s) => s.split(",").map((x) => x.trim()))
    .pipe(z.array(Id).min(1)),
  BACKPACK_API_URL: z.url().default("https://api.backpack.exchange"),
  HYPERLIQUID_API_URL: z.url().default("https://api.hyperliquid.xyz"),
  PORT: z.coerce.number().int().positive().default(8787),
});

export type ExchangeCredentials =
  | { exchange: "backpack"; apiUrl: string; apiKey: string; apiSecret: string }
  | { exchange: "hyperliquid"; apiUrl: string; address: Address };

export type AccountConfig = {
  id: string;
  label: string;
  surfaces: Surface[];
  dbPath: string;
  credentials: ExchangeCredentials;
};

export type Config = { port: number; accounts: AccountConfig[] };

export function hasSurface(account: { surfaces: readonly Surface[] }, surface: Surface): boolean {
  return account.surfaces.includes(surface);
}

function fail(names: Iterable<string>): never {
  throw new Error(`Invalid configuration. Check these .env variables: ${[...new Set(names)].join(", ")}. See .env.example.`);
}

function accountEnv(env: NodeJS.ProcessEnv, id: string): Record<string, string | undefined> {
  const prefix = `ACCOUNT_${id.toUpperCase()}_`;
  return Object.fromEntries(
    Object.entries(env).flatMap(([k, v]) => (k.startsWith(prefix) ? [[k.slice(prefix.length), v]] : [])),
  );
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const bad: string[] = [];
  const server = ServerEnv.safeParse(env);
  if (!server.success) bad.push(...server.error.issues.map((i) => i.path.join(".")));
  const ids = ServerEnv.shape.ACCOUNTS.safeParse(env["ACCOUNTS"]);
  if (!ids.success) return fail(bad);
  if (new Set(ids.data).size !== ids.data.length) bad.push("ACCOUNTS");

  const urls = server.success ? server.data : { BACKPACK_API_URL: "", HYPERLIQUID_API_URL: "" };
  const accounts: AccountConfig[] = [];
  for (const id of new Set(ids.data)) {
    const parsed = AccountEnv.safeParse(accountEnv(env, id));
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const names = issue.code === "unrecognized_keys" ? issue.keys : [String(issue.path[0] ?? "EXCHANGE")];
        bad.push(...names.map((n) => `ACCOUNT_${id.toUpperCase()}_${n}`));
      }
      continue;
    }
    const e = parsed.data;
    accounts.push({
      id,
      label: e.LABEL,
      surfaces: e.SURFACES,
      dbPath: `data/${id}.db`,
      credentials:
        e.EXCHANGE === "backpack"
          ? { exchange: "backpack", apiUrl: urls.BACKPACK_API_URL, apiKey: e.API_KEY, apiSecret: e.API_SECRET }
          : { exchange: "hyperliquid", apiUrl: urls.HYPERLIQUID_API_URL, address: e.ADDRESS },
    });
  }
  if (bad.length === 0 && !accounts.some((a) => hasSurface(a, "dashboard"))) bad.push("ACCOUNTS");
  if (!server.success || bad.length > 0) return fail(bad);
  return { port: server.data.PORT, accounts };
}

export function findAccount(config: Config, id: string): AccountConfig {
  const account = config.accounts.find((a) => a.id === id);
  if (!account) throw new Error(`Unknown account "${id}". Configured: ${config.accounts.map((a) => a.id).join(", ")}`);
  return account;
}
