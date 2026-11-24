import type { SyncMode } from "@life/shared";

// Decides whether a background sync cycle should run right now. Pure on
// purpose (now/timestamps are parameters) so the Neon-saving behavior is
// testable: in "active" mode an idle tick must do NOTHING - not even a
// settings read - or the compute never reaches its 5-minute autosuspend.

// How recently the dashboard must have been used (any authenticated API
// request) for "active" mode to keep syncing: two sync intervals, so one
// last cycle lands after she navigates away.
export const ACTIVITY_WINDOW_MS = 10 * 60 * 1000;

// "Active" mode still runs one cycle per day with no usage at all, so daily
// metrics series (portfolio_value snapshots, contributions zeros) accumulate
// without visits - the reason the loop existed in the first place.
export const CATCHUP_AFTER_MS = 24 * 60 * 60 * 1000;

export function shouldSync(opts: {
  mode: SyncMode;
  now: number;
  lastActivityAt: number | null; // last authenticated /api request (null = none since boot)
  lastCycleAt: number | null; // last completed sync cycle (null = none since boot)
  activityWindowMs?: number;
  catchupAfterMs?: number;
}): boolean {
  const activityWindowMs = opts.activityWindowMs ?? ACTIVITY_WINDOW_MS;
  const catchupAfterMs = opts.catchupAfterMs ?? CATCHUP_AFTER_MS;
  if (opts.mode === "auto") return true;
  if (opts.mode === "manual") return false;
  const activeRecently =
    opts.lastActivityAt != null && opts.now - opts.lastActivityAt <= activityWindowMs;
  // No completed cycle yet counts as overdue, so a fresh boot syncs once.
  const catchupDue = opts.lastCycleAt == null || opts.now - opts.lastCycleAt >= catchupAfterMs;
  return activeRecently || catchupDue;
}
