import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { events, type Db } from "@life/db";
import type { ExerciseInput, ExerciseRow, ExerciseType } from "@life/shared";

// Manually logged workouts live in the generic `events` table:
// source "manual", type "exercise". The workout's own type (run/gym/...),
// duration, calories, and the plain date string live in the payload.
type ExercisePayload = {
  exerciseType: ExerciseType;
  date: string;
  time: string | null; // HH:MM, local — display/sort only, doesn't affect startTs
  totalTime: number | null;
  distanceMiles: number | null;
  caloriesBurned: number | null;
};

function toRow(row: typeof events.$inferSelect): ExerciseRow {
  const p = (row.payload ?? {}) as Partial<ExercisePayload>;
  return {
    id: row.id,
    type: (p.exerciseType ?? "custom") as ExerciseType,
    date: p.date ?? row.startTs.toISOString().slice(0, 10),
    time: p.time ?? null,
    description: row.title,
    totalTime: p.totalTime ?? null,
    distanceMiles: p.distanceMiles ?? null,
    caloriesBurned: p.caloriesBurned ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function createExercise(db: Db, input: ExerciseInput): Promise<ExerciseRow> {
  const payload: ExercisePayload = {
    exerciseType: input.type,
    date: input.date,
    time: input.time ?? null,
    totalTime: input.totalTime ?? null,
    distanceMiles: input.distanceMiles ?? null,
    caloriesBurned: input.caloriesBurned ?? null,
  };
  const row = (
    await db
      .insert(events)
      .values({
        source: "manual",
        externalId: randomUUID(),
        type: "exercise",
        title: input.description ?? null,
        // Noon UTC keeps the event on the intended calendar day regardless of TZ.
        startTs: new Date(`${input.date}T12:00:00Z`),
        payload,
      })
      .returning()
  )[0]!;
  return toRow(row);
}

// Full-replace edit: the form resubmits every field, so omitted optionals clear.
// Returns null when the id isn't a manual exercise row.
export async function updateExercise(
  db: Db,
  id: number,
  input: ExerciseInput,
): Promise<ExerciseRow | null> {
  const payload: ExercisePayload = {
    exerciseType: input.type,
    date: input.date,
    time: input.time ?? null,
    totalTime: input.totalTime ?? null,
    distanceMiles: input.distanceMiles ?? null,
    caloriesBurned: input.caloriesBurned ?? null,
  };
  const rows = await db
    .update(events)
    .set({
      title: input.description ?? null,
      startTs: new Date(`${input.date}T12:00:00Z`),
      payload,
      updatedAt: new Date(),
    })
    .where(and(eq(events.id, id), eq(events.source, "manual"), eq(events.type, "exercise")))
    .returning();
  return rows[0] ? toRow(rows[0]) : null;
}

// Delete a manual exercise row. Returns false when the id isn't a manual
// exercise (so the route can 404 rather than silently succeed).
export async function deleteExercise(db: Db, id: number): Promise<boolean> {
  const deleted = await db
    .delete(events)
    .where(and(eq(events.id, id), eq(events.source, "manual"), eq(events.type, "exercise")))
    .returning({ id: events.id });
  return deleted.length > 0;
}

export async function listExercises(db: Db): Promise<ExerciseRow[]> {
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.source, "manual"), eq(events.type, "exercise")));
  // Workout date descending (most recent first); same-day ties break on time
  // of day descending (untimed entries sort after timed ones, via "" < any
  // "HH:MM"), then on newest-logged. Fixed two-key comparator — always the
  // same criteria regardless of which rows are being compared, so the sort
  // stays transitive.
  return rows.map(toRow).sort((a, b) => {
    const byDate = b.date.localeCompare(a.date);
    if (byDate !== 0) return byDate;
    const byTime = (b.time ?? "").localeCompare(a.time ?? "");
    if (byTime !== 0) return byTime;
    return b.createdAt.localeCompare(a.createdAt);
  });
}
