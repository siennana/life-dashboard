import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { z } from "zod";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
loadEnv({ path: resolve(repoRoot, ".env") });

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  API_TOKEN: z.string().min(16, "API_TOKEN must be at least 16 chars — generate with: openssl rand -hex 24"),
  PORT: z.coerce.number().default(3001),
  VAULT_PATH: z.string().optional(),
});

const env = envSchema.parse(process.env);

export const config = {
  databaseUrl: env.DATABASE_URL,
  apiToken: env.API_TOKEN,
  port: env.PORT,
  vaultPath: env.VAULT_PATH,
};
