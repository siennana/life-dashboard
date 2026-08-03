import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { events, type Db } from "@life/db";
import type { PeriodEntry } from "@life/shared";

// Menstrual cycle ranges live in the generic `events` table: source "manual",
// type "period". startTs/endTs (both already nullable-endTs columns) hold the
// range directly — no payload needed. endTs null = period still ongoing.
function toDayString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function toRow(row: typeof events.$inferSelect): PeriodEntry {
  return {
    id: row.id,
    startDate: toDayString(row.startTs),
    endDate: row.endTs ? toDayString(row.endTs) : null,
  };
}

// Noon UTC keeps the entry on the intended calendar day regardless of TZ.
const toNoonUtc = (date: string) => new Date(`${date}T12:00:00Z`);

async function findOpenPeriod(db: Db) {
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.source, "manual"), eq(events.type, "period"), isNull(events.endTs)))
    .orderBy(desc(events.startTs))
    .limit(1);
  return rows[0] ?? null;
}

export async function markPeriod(
  db: Db,
  date: string,
  kind: "start" | "end",
): Promise<PeriodEntry> {
  const open = await findOpenPeriod(db);

  if (kind === "start") {
    if (open) {
      const updated = (
        await db
          .update(events)
          .set({ startTs: toNoonUtc(date), updatedAt: new Date() })
          .where(eq(events.id, open.id))
          .returning()
      )[0]!;
      return toRow(updated);
    }
    const created = (
      await db
        .insert(events)
        .values({
          source: "manual",
          externalId: randomUUID(),
          type: "period",
          startTs: toNoonUtc(date),
          endTs: null,
        })
        .returning()
    )[0]!;
    return toRow(created);
  }

  // kind === "end"
  if (!open) {
    // No open period to close — log a single-day period at this date.
    const created = (
      await db
        .insert(events)
        .values({
          source: "manual",
          externalId: randomUUID(),
          type: "period",
          startTs: toNoonUtc(date),
          endTs: toNoonUtc(date),
        })
        .returning()
    )[0]!;
    return toRow(created);
  }

  // Marking "end" before the open period's start swaps the two, so the range
  // stays chronological regardless of click order.
  const startDate = toDayString(open.startTs);
  const [newStart, newEnd] = date < startDate ? [date, startDate] : [startDate, date];
  const updated = (
    await db
      .update(events)
      .set({ startTs: toNoonUtc(newStart), endTs: toNoonUtc(newEnd), updatedAt: new Date() })
      .where(eq(events.id, open.id))
      .returning()
  )[0]!;
  return toRow(updated);
}

export async function listPeriods(db: Db): Promise<PeriodEntry[]> {
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.source, "manual"), eq(events.type, "period")))
    .orderBy(desc(events.startTs));
  return rows.map(toRow);
}
