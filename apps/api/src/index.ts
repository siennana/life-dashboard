import { and, asc, eq, sql } from "drizzle-orm";
import Fastify from "fastify";
import { ZodError } from "zod";
import { createDb, events } from "@life/db";
import { config } from "./config";
import { ingestThingsPush } from "./connectors/things";

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
    .where(and(eq(events.source, "things"), eq(events.type, "todo")))
    .orderBy(asc(events.startTs));
  return { todos };
});

app.post("/webhooks/things", async (req, reply) => {
  if (!config.thingsWebhookSecret) {
    return reply.code(503).send({ error: "THINGS_WEBHOOK_SECRET not configured" });
  }
  if (req.headers["x-webhook-secret"] !== config.thingsWebhookSecret) {
    return reply.code(401).send({ error: "unauthorized" });
  }
  return ingestThingsPush(db, req.body);
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
