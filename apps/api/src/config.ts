import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { z } from "zod";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
loadEnv({ path: resolve(repoRoot, ".env") });

// Everything here is optional at the schema level — a missing/invalid value
// should degrade the affected feature (and surface in /health + API error
// responses), not crash the process before it can even report why.
const envSchema = z.object({
  DATABASE_URL: z.string().optional(),
  API_TOKEN: z.string().optional(),
  PORT: z.coerce.number().default(3001),
  VAULT_PATH: z.string().optional(),
  TODOIST_API_TOKEN: z.string().optional(),
  FINNHUB_API_KEY: z.string().optional(),
  ICLOUD_EMAIL: z.string().optional(),
  ICLOUD_APP_PASSWORD: z.string().optional(),
  WEATHER_LOCATION: z.string().optional(),
  WEATHER_LATITUDE: z.coerce.number().optional(),
  WEATHER_LONGITUDE: z.coerce.number().optional(),
  PLAID_CLIENT_ID: z.string().optional(),
  PLAID_SECRET: z.string().optional(),
  PLAID_ENV: z.enum(["sandbox", "production"]).default("production"),
  PLAID_ACCESS_TOKEN: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);
const env = parsed.success ? parsed.data : envSchema.parse({});

const warnings: string[] = [];
if (!parsed.success) {
  warnings.push(`could not parse .env, falling back to defaults (${parsed.error.message})`);
}

function checkToken(name: string, value: string | undefined, minLen = 16): string | undefined {
  if (!value) {
    warnings.push(`${name} is not set`);
    return undefined;
  }
  if (value.length < minLen) {
    warnings.push(`${name} looks invalid (shorter than ${minLen} chars) — generate with: openssl rand -hex 24`);
    return undefined;
  }
  return value;
}

const apiToken = checkToken("API_TOKEN", env.API_TOKEN);
const todoistApiToken = checkToken("TODOIST_API_TOKEN", env.TODOIST_API_TOKEN);
if (!env.DATABASE_URL) warnings.push("DATABASE_URL is not set");
if (!env.FINNHUB_API_KEY) warnings.push("FINNHUB_API_KEY is not set - live prices will be unavailable");
if (!env.ICLOUD_EMAIL || !env.ICLOUD_APP_PASSWORD) {
  warnings.push("ICLOUD_EMAIL / ICLOUD_APP_PASSWORD not set - calendar sync disabled");
}
if (!env.PLAID_CLIENT_ID || !env.PLAID_SECRET) {
  warnings.push("PLAID_CLIENT_ID / PLAID_SECRET not set - bank spending sync disabled");
} else if (!env.PLAID_ACCESS_TOKEN) {
  warnings.push("PLAID_ACCESS_TOKEN not set - connect a bank at /plaid-link, then paste the token");
}

for (const w of warnings) console.warn(`[config] ${w}`);

export const config = {
  databaseUrl: env.DATABASE_URL,
  apiToken,
  port: env.PORT,
  vaultPath: env.VAULT_PATH,
  todoistApiToken,
  finnhubApiKey: env.FINNHUB_API_KEY,
  icloudEmail: env.ICLOUD_EMAIL,
  icloudAppPassword: env.ICLOUD_APP_PASSWORD,
  weatherLocation: env.WEATHER_LOCATION,
  weatherLatitude: env.WEATHER_LATITUDE,
  weatherLongitude: env.WEATHER_LONGITUDE,
  plaidClientId: env.PLAID_CLIENT_ID,
  plaidSecret: env.PLAID_SECRET,
  plaidEnv: env.PLAID_ENV,
  plaidAccessToken: env.PLAID_ACCESS_TOKEN,
  warnings,
};
