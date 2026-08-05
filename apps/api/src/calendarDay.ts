import { eq } from "drizzle-orm";
import { calendarDays, type Db } from "@life/db";
import type { CalendarDayLog } from "@life/shared";

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
