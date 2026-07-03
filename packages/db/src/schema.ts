import {
  date,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Anything with a time range: todos, workouts, calendar events, journal index.
export const events = pgTable(
  "events",
  {
    id: serial("id").primaryKey(),
    source: text("source").notNull(),
    externalId: text("external_id").notNull(),
    type: text("type").notNull(),
    title: text("title"),
    startTs: timestamp("start_ts", { withTimezone: true }).notNull(),
    endTs: timestamp("end_ts", { withTimezone: true }),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("events_source_external_id").on(t.source, t.externalId)],
);

// Daily scalar values: calories, steps, weight, sleep hours.
export const metrics = pgTable(
  "metrics",
  {
    id: serial("id").primaryKey(),
    source: text("source").notNull(),
    name: text("name").notNull(),
    value: numeric("value").notNull(),
    unit: text("unit"),
    date: date("date").notNull(),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("metrics_source_name_date").on(t.source, t.name, t.date)],
);

// One row per connector run — powers the sync-status widget.
export const syncRuns = pgTable("sync_runs", {
  id: serial("id").primaryKey(),
  source: text("source").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: text("status").notNull().default("running"),
  error: text("error"),
  cursor: text("cursor"),
});
