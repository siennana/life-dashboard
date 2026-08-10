import {
  date,
  integer,
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

// App preferences (font, theme, ...) as a tiny key/value store — one row per
// settings group, options in jsonb. Deliberately not events/metrics: settings
// have no timestamp or scalar semantics, so shoehorning them there would abuse
// the generic schema more than a dedicated 3-column table does.
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Confirmed/dismissed recurring-charge series (rent, subscriptions). Like
// `settings`, a deliberate exception to the generic schema: a series is a
// *pattern* (merchant + amount + cadence), not an event — and it must be keyed
// on content, not transaction ids, so it survives Plaid re-links wiping and
// re-issuing every transaction row. Suggestions are never stored; they're
// re-detected from history at read time, and a row here either promotes one
// (confirmed) or hides it (dismissed).
export const recurringSeries = pgTable(
  "recurring_series",
  {
    id: serial("id").primaryKey(),
    merchant: text("merchant").notNull(), // display name ("Netflix")
    merchantKey: text("merchant_key").notNull(), // normalized grouping key
    amount: numeric("amount").notNull(), // expected charge; matches within ±25%
    frequency: text("frequency").notNull(), // weekly | biweekly | monthly | yearly
    status: text("status").notNull(), // confirmed | dismissed
    // When the series is expected to stop charging (loan payoff, planned
    // cancellation). Null = indefinite. A matched charge dated after this
    // flags the series in the widget.
    expiresOn: date("expires_on"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("recurring_series_merchant_key").on(t.merchantKey)],
);

// User-defined labels (home, entertainment, cloud...) — pure data, no
// hardcoded per-label logic anywhere. Same generic-schema exception family as
// `settings`/`recurring_series`.
export const tags = pgTable(
  "tags",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    color: text("color").notNull(), // one of TAG_COLORS in @life/shared
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("tags_name").on(t.name)],
);

// Tag → merchant assignments, keyed on the normalized merchant key (content,
// not transaction ids) so they survive Plaid re-links, and every past+future
// charge from the merchant carries the tag. Per-transaction overrides
// (one-off adds / rule exclusions) are a future layer — see todo.md.
export const tagRules = pgTable(
  "tag_rules",
  {
    id: serial("id").primaryKey(),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    merchant: text("merchant").notNull(), // display name
    merchantKey: text("merchant_key").notNull(), // normalized grouping key
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("tag_rules_tag_merchant").on(t.tagId, t.merchantKey)],
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

// One row per calendar day, holding whatever's attached to that day in the
// calendar's day-detail form. Only `log` (free text) is implemented so far;
// todos/schedule are placeholders in the UI and will get their own columns
// (or relations) here once built.
export const calendarDays = pgTable(
  "calendar_days",
  {
    id: serial("id").primaryKey(),
    date: date("date").notNull(),
    log: text("log"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("calendar_days_date").on(t.date)],
);
