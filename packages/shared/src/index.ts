import { z } from "zod";

export const SOURCES = ["things", "strava", "health", "calendar", "vault"] as const;
export const sourceSchema = z.enum(SOURCES);
export type Source = z.infer<typeof sourceSchema>;

export const syncStatusSchema = z.object({
  source: z.string(),
  started_at: z.coerce.date(),
  finished_at: z.coerce.date().nullable(),
  status: z.enum(["running", "ok", "error"]),
  error: z.string().nullable(),
});
export type SyncStatus = z.infer<typeof syncStatusSchema>;

export const statusResponseSchema = z.object({
  sources: z.array(syncStatusSchema),
});
export type StatusResponse = z.infer<typeof statusResponseSchema>;

// Payload the Things iOS Shortcut POSTs to /webhooks/things.
// Loose on purpose — Shortcuts dictionaries are easy to get slightly wrong.
export const thingsTodoSchema = z.looseObject({
  id: z.string().min(1),
  title: z.string(),
  status: z.string().default("open"),
  notes: z.string().nullish(),
  dueDate: z.string().nullish(),
  list: z.string().nullish(),
  tags: z.union([z.array(z.string()), z.string()]).nullish(),
});
export type ThingsTodo = z.infer<typeof thingsTodoSchema>;

export const thingsPushSchema = z.object({
  todos: z.array(thingsTodoSchema),
});
export type ThingsPush = z.infer<typeof thingsPushSchema>;
