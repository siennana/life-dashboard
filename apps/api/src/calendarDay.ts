import { desc, eq, ilike, sql } from "drizzle-orm";
import { calendarDays, type Db } from "@life/db";
import type {
  CalendarLastUpdated,
  CalendarDayLog,
  DaySearchHit,
  DaySearchResponse,
  LoggedDaysResponse,
} from "@life/shared";

// Calendar-day detail (currently just a free-text log), one row per date in
// `calendar_days`. Upserted on the unique `date` index.
export async function getDayLog(db: Db, date: string): Promise<CalendarDayLog> {
  const rows = await db.select().from(calendarDays).where(eq(calendarDays.date, date)).limit(1);
  return { date, log: rows[0]?.log ?? null };
}

export async function saveDayLog(db: Db, date: string, log: string | null): Promise<CalendarDayLog> {
  const rows = await db
    .insert(calendarDays)
    .values({ date, log })
    .onConflictDoUpdate({ target: calendarDays.date, set: { log, updatedAt: new Date() } })
    .returning();
  const row = rows[0]!;
  return { date: row.date, log: row.log };
}

// Every date with a non-blank log — the calendar's Logged (pencil) datalet
// mark — plus the head of each log for the month-cell preview. Whitespace-only
// logs don't count as logged.
export async function getLoggedDays(db: Db): Promise<LoggedDaysResponse> {
  const rows = await db
    .select({ date: calendarDays.date, log: calendarDays.log })
    .from(calendarDays)
    .where(sql`${calendarDays.log} is not null and btrim(${calendarDays.log}) <> ''`);
  return {
    days: rows.map((r) => r.date),
    // A few clamped lines is all a cell can show - no need to ship the whole
    // (up to 20k char) entry to the month grid.
    snippets: Object.fromEntries(rows.map((r) => [r.date, (r.log ?? "").trim().slice(0, 300)])),
  };
}

// Most recent calendar-day edit across all days — powers the "last saved"
// stamp at the top of the Calendar page.
export async function getLastUpdated(db: Db): Promise<CalendarLastUpdated> {
  const rows = await db
    .select({ updatedAt: calendarDays.updatedAt })
    .from(calendarDays)
    .orderBy(desc(calendarDays.updatedAt))
    .limit(1);
  return { updatedAt: rows[0]?.updatedAt?.toISOString() ?? null };
}

// Context (in chars) kept on each side of a search match in a snippet.
const SNIPPET_BEFORE = 40;
const SNIPPET_AFTER = 80;

// Pure: locate `query` in `log` (case-insensitive) and cut a one-line snippet
// around the first occurrence. Whitespace runs collapse to single spaces so
// multi-line entries read as one row. Returns null when there is no match.
export function snippetFor(
  log: string,
  query: string,
): Omit<DaySearchHit, "date"> | null {
  const q = query.trim();
  if (!q) return null;
  const text = log.replace(/\s+/g, " ");
  const haystack = text.toLowerCase();
  const needle = q.toLowerCase();
  const idx = haystack.indexOf(needle);
  if (idx < 0) return null;
  let matches = 0;
  for (let i = haystack.indexOf(needle); i >= 0; i = haystack.indexOf(needle, i + needle.length)) {
    matches++;
  }
  const start = Math.max(0, idx - SNIPPET_BEFORE);
  const end = Math.min(text.length, idx + needle.length + SNIPPET_AFTER);
  return {
    before: (start > 0 ? "..." : "") + text.slice(start, idx).trimStart(),
    match: text.slice(idx, idx + needle.length),
    after: text.slice(idx + needle.length, end).trimEnd() + (end < text.length ? "..." : ""),
    matches,
  };
}

// Escape LIKE metacharacters so the user's text is matched literally.
const likeLiteral = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

// Days whose log contains `query`, newest first. Postgres ILIKE narrows the
// candidate set; the snippet is cut in TS from the full log.
export async function searchDayLogs(db: Db, query: string, limit = 50): Promise<DaySearchResponse> {
  const q = query.trim();
  if (!q) return { query: q, hits: [] };
  const rows = await db
    .select({ date: calendarDays.date, log: calendarDays.log })
    .from(calendarDays)
    .where(ilike(calendarDays.log, `%${likeLiteral(q)}%`))
    .orderBy(desc(calendarDays.date))
    .limit(limit);
  const hits: DaySearchHit[] = [];
  for (const r of rows) {
    const snip = snippetFor(r.log ?? "", q);
    if (snip) hits.push({ date: r.date, ...snip });
  }
  return { query: q, hits };
}
