import { z } from "zod";

const ConfigSchema = z.object({
  BACKPACK_API_URL: z.url(),
  BACKPACK_WS_API_URL: z.string().min(1),
  BACKPACK_API_KEY: z.string().min(1),
  BACKPACK_API_SECRET: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(8787),
  DB_PATH: z.string().default("data/dashboard.db"),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = ConfigSchema.safeParse(env);
  if (parsed.success) return parsed.data;
  const fields = [...new Set(parsed.error.issues.map((i) => i.path.join(".")))];
  throw new Error(`Invalid configuration. Check these .env variables: ${fields.join(", ")}`);
}
