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
