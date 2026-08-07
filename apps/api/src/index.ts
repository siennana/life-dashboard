import { and, asc, desc, eq, sql } from "drizzle-orm";
import Fastify from "fastify";
import { ZodError } from "zod";
import { createDb, events } from "@life/db";
import { config } from "./config";
import { closeTodoistTask, syncTodoist } from "./connectors/todoist";
import { importFidelityCsv } from "./connectors/fidelity";
import { buildPortfolio } from "./finance";
import { createExercise, listExercises, updateExercise } from "./exercise";
import { createBook, listBooks, updateBook } from "./books";
import { syncICloud } from "./connectors/icloud";
import { getWeather } from "./weather";
import { listPeriodDays, togglePeriodDay } from "./period";
import { getDayLog, getLastUpdated, saveDayLog } from "./calendarDay";
import { buildDailyCashflow, buildDayTransactions, buildSpendingDashboard } from "./spending";
import {
  createLinkToken,
  exchangePublicToken,
  syncPlaid,
  type PlaidCreds,
} from "./connectors/plaid";
import {
  bookInputSchema,
  exerciseInputSchema,
  periodToggleInputSchema,
  plaidExchangeInputSchema,
  saveDayLogInputSchema,
} from "@life/shared";

const app = Fastify({ logger: true });

// The Fidelity upload posts the raw CSV as the request body.
app.addContentTypeParser(
  ["text/csv", "text/plain"],
  { parseAs: "string" },
  (_req, body, done) => done(null, body),
);
const { databaseUrl } = config;
const db = databaseUrl ? createDb(databaseUrl) : null;

if (config.warnings.length > 0) {
  app.log.warn({ warnings: config.warnings }, "starting with incomplete configuration");
}

// Everything under /api/* requires the bearer token; /health and /webhooks/*
// (which use their own shared secrets) do not.
app.addHook("onRequest", async (req, reply) => {
  if (!req.url.startsWith("/api/")) return;
  if (!config.apiToken) {
    return reply.code(500).send({ error: "server misconfigured: API_TOKEN is not set in .env" });
  }
  if (req.headers.authorization !== `Bearer ${config.apiToken}`) {
    return reply.code(401).send({ error: "unauthorized" });
  }
});

app.get("/health", async () => {
  if (!db) return { ok: false, db: "not configured" };
  try {
    await db.execute(sql`select 1`);
    return { ok: true, db: "up" };
  } catch (err) {
    return { ok: false, db: "down", error: String(err) };
  }
});

// Latest sync run per source, plus a live DB ping — powers the sync-status widget.
app.get("/api/status", async (_req, reply) => {
  if (!db) return reply.code(503).send({ error: "database not configured: DATABASE_URL is not set" });
  const rows = await db.execute(sql`
    select distinct on (source) source, started_at, finished_at, status, error
    from sync_runs
    order by source, started_at desc
  `);
  let database: { status: "ok" | "error"; checkedAt: Date; error: string | null };
  try {
    await db.execute(sql`select 1`);
    database = { status: "ok", checkedAt: new Date(), error: null };
  } catch (err) {
    database = { status: "error", checkedAt: new Date(), error: String(err) };
  }
  return { sources: rows, database };
});

app.get("/api/todos", async (_req, reply) => {
  if (!db) return reply.code(503).send({ error: "database not configured: DATABASE_URL is not set" });
  const todos = await db
    .select()
    .from(events)
    .where(and(eq(events.source, "todoist"), eq(events.type, "todo")))
    .orderBy(asc(events.startTs));
  return { todos };
});

app.post("/api/todos/:externalId/close", async (req, reply) => {
  if (!db) return reply.code(503).send({ error: "database not configured: DATABASE_URL is not set" });
  if (!config.todoistApiToken) {
    return reply.code(503).send({ error: "TODOIST_API_TOKEN not configured" });
  }
  const { externalId } = req.params as { externalId: string };
  return closeTodoistTask(db, config.todoistApiToken, externalId);
});

// Delete all completed todoist rows from the DB. Completed todos are only a
// local archive (the task is already closed in Todoist), so this just prunes
// history. A still-active task deleted here would re-sync on the next pull.
app.delete("/api/todos/completed", async (_req, reply) => {
  if (!db) return reply.code(503).send({ error: "database not configured: DATABASE_URL is not set" });
  const deleted = await db
    .delete(events)
    .where(
      and(eq(events.source, "todoist"), eq(events.type, "todo"), sql`payload->>'status' = 'completed'`),
    )
    .returning({ id: events.id });
  return { deleted: deleted.length };
});

// Delete one todo row by external id (per-row delete on the completed list).
app.delete("/api/todos/:externalId", async (req, reply) => {
  if (!db) return reply.code(503).send({ error: "database not configured: DATABASE_URL is not set" });
  const { externalId } = req.params as { externalId: string };
  await db
    .delete(events)
    .where(and(eq(events.source, "todoist"), eq(events.externalId, externalId)));
  return { ok: true };
});

// Finance: upload a Fidelity positions CSV (raw text body) → store holdings.
app.post("/api/finance/holdings/upload", async (req, reply) => {
  if (!db) return reply.code(503).send({ error: "database not configured: DATABASE_URL is not set" });
  const csv = typeof req.body === "string" ? req.body : "";
  if (!csv.trim()) return reply.code(400).send({ error: "empty upload - expected CSV text" });
  return importFidelityCsv(db, csv);
});

// Finance: stored holdings priced with live quotes (cached ~45s).
app.get("/api/finance/portfolio", async (_req, reply) => {
  if (!db) return reply.code(503).send({ error: "database not configured: DATABASE_URL is not set" });
  return buildPortfolio(db, config.finnhubApiKey);
});

// Weather: live 7-day forecast from Open-Meteo for the configured location.
app.get("/api/weather", async () => getWeather(config));

// Plaid credentials from .env, or null until both keys are set.
function plaidCreds(): PlaidCreds | null {
  if (!config.plaidClientId || !config.plaidSecret) return null;
  return { clientId: config.plaidClientId, secret: config.plaidSecret, env: config.plaidEnv };
}

// Plaid one-time linking: mint a Link token, then exchange the public token
// Link hands back. The resulting access token gets pasted into .env.
app.post("/api/plaid/link-token", async (_req, reply) => {
  const creds = plaidCreds();
  if (!creds) {
    return reply.code(503).send({ error: "PLAID_CLIENT_ID / PLAID_SECRET not configured" });
  }
  return createLinkToken(creds);
});

app.post("/api/plaid/exchange", async (req, reply) => {
  const creds = plaidCreds();
  if (!creds) {
    return reply.code(503).send({ error: "PLAID_CLIENT_ID / PLAID_SECRET not configured" });
  }
  const { public_token } = plaidExchangeInputSchema.parse(req.body);
  return exchangePublicToken(creds, public_token);
});

// Spending dashboard: one month of stats (?month=YYYY-MM, default latest) plus
// history-wide trend + recurring-charge detection. Logic in spending.ts.
app.get("/api/finance/spending", async (req, reply) => {
  if (!db) return reply.code(503).send({ error: "database not configured: DATABASE_URL is not set" });
  const { month } = req.query as { month?: string };
  return buildSpendingDashboard(db, {
    configured: plaidCreds() != null,
    linked: Boolean(config.plaidAccessToken),
    month,
  });
});

// Net cashflow per day (income − spend), for the per-day figure on the calendar.
app.get("/api/finance/cashflow", async (_req, reply) => {
  if (!db) return reply.code(503).send({ error: "database not configured: DATABASE_URL is not set" });
  return buildDailyCashflow(db);
});

// All plaid transactions on one day, for the calendar day-detail list.
app.get("/api/finance/transactions/:date", async (req, reply) => {
  if (!db) return reply.code(503).send({ error: "database not configured: DATABASE_URL is not set" });
  const { date } = req.params as { date: string };
  if (!DATE_PARAM.test(date)) return reply.code(400).send({ error: "invalid date - expected YYYY-MM-DD" });
  return buildDayTransactions(db, date);
});

// Calendar: events synced read-only from iCloud, ordered by start time.
app.get("/api/calendar/events", async (_req, reply) => {
  if (!db) return reply.code(503).send({ error: "database not configured: DATABASE_URL is not set" });
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.source, "calendar"), eq(events.type, "calendar-event")))
    .orderBy(asc(events.startTs));
  return {
    events: rows.map((r) => {
      const p = (r.payload ?? {}) as { allDay?: boolean; calendar?: string; location?: string };
      return {
        id: r.id,
        title: r.title ?? "(untitled)",
        start: r.startTs.toISOString(),
        end: r.endTs?.toISOString() ?? null,
        allDay: p.allDay ?? false,
        calendar: p.calendar ?? null,
        location: p.location ?? null,
      };
    }),
  };
});

const DATE_PARAM = /^\d{4}-\d{2}-\d{2}$/;

// Most recent calendar-day edit — the "last saved" stamp on the Calendar page.
app.get("/api/calendar/last-updated", async (_req, reply) => {
  if (!db) return reply.code(503).send({ error: "database not configured: DATABASE_URL is not set" });
  return getLastUpdated(db);
});

// Calendar day detail: the free-text log for a day's expanded-cell form.
app.get("/api/calendar/day/:date", async (req, reply) => {
  if (!db) return reply.code(503).send({ error: "database not configured: DATABASE_URL is not set" });
  const { date } = req.params as { date: string };
  if (!DATE_PARAM.test(date)) return reply.code(400).send({ error: "invalid date - expected YYYY-MM-DD" });
  return getDayLog(db, date);
});

app.put("/api/calendar/day/:date", async (req, reply) => {
  if (!db) return reply.code(503).send({ error: "database not configured: DATABASE_URL is not set" });
  const { date } = req.params as { date: string };
  if (!DATE_PARAM.test(date)) return reply.code(400).send({ error: "invalid date - expected YYYY-MM-DD" });
  const { log } = saveDayLogInputSchema.parse(req.body);
  return saveDayLog(db, date, log.trim() || null);
});

// Period tracking: toggle a day as menstruating (right-click on the calendar),
// list all menstruating days.
app.get("/api/period", async (_req, reply) => {
  if (!db) return reply.code(503).send({ error: "database not configured: DATABASE_URL is not set" });
  return { days: await listPeriodDays(db) };
});

app.post("/api/period/toggle", async (req, reply) => {
  if (!db) return reply.code(503).send({ error: "database not configured: DATABASE_URL is not set" });
  const { date } = periodToggleInputSchema.parse(req.body);
  return togglePeriodDay(db, date);
});

// Exercise: manually log a workout / list all logged workouts.
app.post("/api/exercises", async (req, reply) => {
  if (!db) return reply.code(503).send({ error: "database not configured: DATABASE_URL is not set" });
  const input = exerciseInputSchema.parse(req.body);
  return createExercise(db, input);
});

app.get("/api/exercises", async (_req, reply) => {
  if (!db) return reply.code(503).send({ error: "database not configured: DATABASE_URL is not set" });
  return { exercises: await listExercises(db) };
});

app.put("/api/exercises/:id", async (req, reply) => {
  if (!db) return reply.code(503).send({ error: "database not configured: DATABASE_URL is not set" });
  const id = Number((req.params as { id: string }).id);
  if (!Number.isInteger(id)) return reply.code(400).send({ error: "invalid exercise id" });
  const input = exerciseInputSchema.parse(req.body);
  const row = await updateExercise(db, id, input);
  if (!row) return reply.code(404).send({ error: "exercise not found" });
  return row;
});

// Reading: manually log a book / list all logged books.
app.post("/api/books", async (req, reply) => {
  if (!db) return reply.code(503).send({ error: "database not configured: DATABASE_URL is not set" });
  const input = bookInputSchema.parse(req.body);
  return createBook(db, input);
});

app.get("/api/books", async (_req, reply) => {
  if (!db) return reply.code(503).send({ error: "database not configured: DATABASE_URL is not set" });
  return { books: await listBooks(db) };
});

app.put("/api/books/:id", async (req, reply) => {
  if (!db) return reply.code(503).send({ error: "database not configured: DATABASE_URL is not set" });
  const id = Number((req.params as { id: string }).id);
  if (!Number.isInteger(id)) return reply.code(400).send({ error: "invalid book id" });
  const input = bookInputSchema.parse(req.body);
  const row = await updateBook(db, id, input);
  if (!row) return reply.code(404).send({ error: "book not found" });
  return row;
});

// The connectors that can be synced on demand, keyed by their sync_runs source.
const SYNCABLE_SOURCES = ["todoist", "calendar", "plaid"] as const;
type SyncableSource = (typeof SYNCABLE_SOURCES)[number];

// Run one connector by its source key. Returns the connector's own result, or a
// { skipped } marker when its creds aren't configured. May throw (the caller
// decides whether to degrade to { error }).
function runConnector(activeDb: NonNullable<typeof db>, source: SyncableSource): Promise<unknown> {
  switch (source) {
    case "todoist":
      return config.todoistApiToken
        ? syncTodoist(activeDb, config.todoistApiToken)
        : Promise.resolve({ skipped: "not configured" });
    case "calendar":
      return config.icloudEmail && config.icloudAppPassword
        ? syncICloud(activeDb, config.icloudEmail, config.icloudAppPassword)
        : Promise.resolve({ skipped: "not configured" });
    case "plaid": {
      const creds = plaidCreds();
      return creds && config.plaidAccessToken
        ? syncPlaid(activeDb, creds, config.plaidAccessToken)
        : Promise.resolve({ skipped: "not configured" });
    }
  }
}

app.post("/api/sync", async (_req, reply) => {
  if (!db) return reply.code(503).send({ error: "database not configured: DATABASE_URL is not set" });
  const results: Record<string, unknown> = {};
  for (const source of SYNCABLE_SOURCES) {
    results[source] = await runConnector(db, source).catch((err) => ({ error: String(err) }));
  }
  return results;
});

// Sync a single connector on demand (Sync buttons on the Todos page / Sync
// status widget). Writes straight to the live DB (Neon), same as the 5-min loop.
app.post("/api/sync/:source", async (req, reply) => {
  if (!db) return reply.code(503).send({ error: "database not configured: DATABASE_URL is not set" });
  const source = (req.params as { source: string }).source;
  if (!SYNCABLE_SOURCES.includes(source as SyncableSource)) {
    return reply.code(404).send({ error: `unknown sync source: ${source}` });
  }
  const result = await runConnector(db, source as SyncableSource).catch((err) => ({
    error: String(err),
  }));
  return { source, result };
});

// postgres.js wraps connection failures in a `cause` chain rather than the
// top-level message, so walk it to tell "DB is down" apart from other bugs.
function isConnectionRefused(err: unknown, depth = 0): boolean {
  if (!err || depth > 5) return false;
  if (err instanceof AggregateError) return err.errors.some((e) => isConnectionRefused(e, depth + 1));
  if (err instanceof Error) {
    if (err.message.includes("ECONNREFUSED")) return true;
    return isConnectionRefused(err.cause, depth + 1);
  }
  return false;
}

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof ZodError) {
    return reply.code(400).send({ error: "invalid payload", issues: err.issues });
  }
  app.log.error(err);
  if (isConnectionRefused(err)) {
    return reply.code(503).send({ error: "database unreachable — is postgres running? (pnpm db:up)" });
  }
  return reply.code(500).send({ error: "internal error" });
});

app.listen({ port: config.port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

// Pull-based connectors: sync on boot, then every 5 minutes. Each configured
// connector runs independently — one failing must not block the others.
const SYNC_INTERVAL_MS = 5 * 60 * 1000;
let syncing = false;
async function runSyncs() {
  const activeDb = db;
  if (syncing || !activeDb) return;
  syncing = true;
  try {
    if (config.todoistApiToken) {
      try {
        await syncTodoist(activeDb, config.todoistApiToken);
      } catch (err) {
        app.log.error({ err }, "todoist sync failed");
      }
    }
    if (config.icloudEmail && config.icloudAppPassword) {
      try {
        await syncICloud(activeDb, config.icloudEmail, config.icloudAppPassword);
      } catch (err) {
        app.log.error({ err }, "icloud calendar sync failed");
      }
    }
    const creds = plaidCreds();
    if (creds && config.plaidAccessToken) {
      try {
        await syncPlaid(activeDb, creds, config.plaidAccessToken);
      } catch (err) {
        app.log.error({ err }, "plaid sync failed");
      }
    }
    // Daily portfolio-value snapshot: buildPortfolio upserts today's metrics
    // row as a side effect, so the series accumulates even on days the Stocks
    // page is never opened. Quotes come from cache when the page was just up.
    if (config.finnhubApiKey) {
      try {
        await buildPortfolio(activeDb, config.finnhubApiKey);
      } catch (err) {
        app.log.error({ err }, "portfolio snapshot failed");
      }
    }
  } finally {
    syncing = false;
  }
}
void runSyncs();
setInterval(runSyncs, SYNC_INTERVAL_MS);
