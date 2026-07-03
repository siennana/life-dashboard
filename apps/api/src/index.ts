import { and, asc, eq, sql } from "drizzle-orm";
import Fastify from "fastify";
import { ZodError } from "zod";
import { createDb, events } from "@life/db";
import { config } from "./config";
import { closeTodoistTask, syncTodoist } from "./connectors/todoist";

const app = Fastify({ logger: true });
const db = createDb(config.databaseUrl);

// Everything under /api/* requires the bearer token; /health and /webhooks/*
// (which use their own shared secrets) do not.
app.addHook("onRequest", async (req, reply) => {
  if (!req.url.startsWith("/api/")) return;
  if (req.headers.authorization !== `Bearer ${config.apiToken}`) {
    return reply.code(401).send({ error: "unauthorized" });
  }
});

app.get("/health", async () => {
  await db.execute(sql`select 1`);
  return { ok: true, db: "up" };
});

// Latest sync run per source — powers the sync-status widget.
app.get("/api/status", async () => {
  const rows = await db.execute(sql`
    select distinct on (source) source, started_at, finished_at, status, error
    from sync_runs
    order by source, started_at desc
  `);
  return { sources: rows };
});

app.get("/api/todos", async () => {
  const todos = await db
    .select()
    .from(events)
    .where(and(eq(events.source, "todoist"), eq(events.type, "todo")))
    .orderBy(asc(events.startTs));
  return { todos };
});

app.post("/api/todos/:externalId/close", async (req, reply) => {
  if (!config.todoistApiToken) {
    return reply.code(503).send({ error: "TODOIST_API_TOKEN not configured" });
  }
  const { externalId } = req.params as { externalId: string };
  return closeTodoistTask(db, config.todoistApiToken, externalId);
});

app.post("/api/sync", async () => {
  if (!config.todoistApiToken) return { skipped: "todoist not configured" };
  return syncTodoist(db, config.todoistApiToken);
});

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof ZodError) {
    return reply.code(400).send({ error: "invalid payload", issues: err.issues });
  }
  app.log.error(err);
  return reply.code(500).send({ error: "internal error" });
});

app.listen({ port: config.port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

// Pull-based connectors: sync on boot, then every 5 minutes.
const SYNC_INTERVAL_MS = 5 * 60 * 1000;
let syncing = false;
async function runSyncs() {
  if (syncing || !config.todoistApiToken) return;
  syncing = true;
  try {
    await syncTodoist(db, config.todoistApiToken);
  } catch (err) {
    app.log.error({ err }, "todoist sync failed");
  } finally {
    syncing = false;
  }
}
void runSyncs();
setInterval(runSyncs, SYNC_INTERVAL_MS);
