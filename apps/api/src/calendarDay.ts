import { desc, eq, sql } from "drizzle-orm";
import { calendarDays, type Db } from "@life/db";
import type { CalendarLastUpdated, CalendarDayLog, LoggedDaysResponse } from "@life/shared";

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
// mark. Whitespace-only logs don't count as logged.
export async function getLoggedDays(db: Db): Promise<LoggedDaysResponse> {
  const rows = await db
    .select({ date: calendarDays.date })
    .from(calendarDays)
    .where(sql`${calendarDays.log} is not null and btrim(${calendarDays.log}) <> ''`);
  return { days: rows.map((r) => r.date) };
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
