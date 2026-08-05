import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { events, type Db } from "@life/db";
import type { PeriodToggleResult } from "@life/shared";

// Menstrual cycle tracking: each menstruating day is one row in the generic
// `events` table (source "manual", type "period"), keyed by that day's date.
// No ranges — a day is either marked or not.
const toNoonUtc = (date: string) => new Date(`${date}T12:00:00Z`);
const toDayString = (d: Date) => d.toISOString().slice(0, 10);

async function findDay(db: Db, date: string) {
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.source, "manual"), eq(events.type, "period"), eq(events.startTs, toNoonUtc(date))))
    .limit(1);
  return rows[0] ?? null;
}

// Toggle a single day's menstruating flag: delete the row if it exists, else
// insert one. Returns the resulting marked state.
export async function togglePeriodDay(db: Db, date: string): Promise<PeriodToggleResult> {
  const existing = await findDay(db, date);
  if (existing) {
    await db.delete(events).where(eq(events.id, existing.id));
    return { date, marked: false };
  }
  await db.insert(events).values({
    source: "manual",
    externalId: randomUUID(),
    type: "period",
    startTs: toNoonUtc(date),
    endTs: null,
  });
  return { date, marked: true };
}

// All menstruating days, as sorted YYYY-MM-DD strings.
export async function listPeriodDays(db: Db): Promise<string[]> {
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.source, "manual"), eq(events.type, "period")));
  return rows.map((r) => toDayString(r.startTs)).sort();
}
