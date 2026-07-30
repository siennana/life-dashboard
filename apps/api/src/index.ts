import { and, asc, eq, sql } from "drizzle-orm";
import Fastify from "fastify";
import { ZodError } from "zod";
import { createDb, events } from "@life/db";
import { config } from "./config";
import { closeTodoistTask, syncTodoist } from "./connectors/todoist";
import { importFidelityCsv } from "./connectors/fidelity";
import { buildPortfolio } from "./finance";
import { createExercise, listExercises } from "./exercise";
import { createBook, listBooks, updateBook } from "./books";
import { syncICloud } from "./connectors/icloud";
import { getWeather } from "./weather";
import { bookInputSchema, exerciseInputSchema } from "@life/shared";

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

// Latest sync run per source — powers the sync-status widget.
app.get("/api/status", async (_req, reply) => {
  if (!db) return reply.code(503).send({ error: "database not configured: DATABASE_URL is not set" });
  const rows = await db.execute(sql`
    select distinct on (source) source, started_at, finished_at, status, error
    from sync_runs
    order by source, started_at desc
  `);
  return { sources: rows };
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

app.post("/api/sync", async (_req, reply) => {
  if (!db) return reply.code(503).send({ error: "database not configured: DATABASE_URL is not set" });
  const results: Record<string, unknown> = {};
  results.todoist = config.todoistApiToken
    ? await syncTodoist(db, config.todoistApiToken).catch((err) => ({ error: String(err) }))
    : { skipped: "not configured" };
  results.calendar =
    config.icloudEmail && config.icloudAppPassword
      ? await syncICloud(db, config.icloudEmail, config.icloudAppPassword).catch((err) => ({
          error: String(err),
        }))
      : { skipped: "not configured" };
  return results;
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
  } finally {
    syncing = false;
  }
}
void runSyncs();
setInterval(runSyncs, SYNC_INTERVAL_MS);
