import { sql } from "drizzle-orm";
import Fastify from "fastify";
import { createDb } from "@life/db";
import { config } from "./config";

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

app.listen({ port: config.port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
