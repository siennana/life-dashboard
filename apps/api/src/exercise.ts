import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { events, type Db } from "@life/db";
import type { ExerciseInput, ExerciseRow, ExerciseType } from "@life/shared";

// Manually logged workouts live in the generic `events` table:
// source "manual", type "exercise". The workout's own type (run/gym/...),
// duration, calories, and the plain date string live in the payload.
type ExercisePayload = {
  exerciseType: ExerciseType;
  date: string;
  totalTime: number | null;
  caloriesBurned: number | null;
};

function toRow(row: typeof events.$inferSelect): ExerciseRow {
  const p = (row.payload ?? {}) as Partial<ExercisePayload>;
  return {
    id: row.id,
    type: (p.exerciseType ?? "custom") as ExerciseType,
    date: p.date ?? row.startTs.toISOString().slice(0, 10),
    description: row.title,
    totalTime: p.totalTime ?? null,
    caloriesBurned: p.caloriesBurned ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function createExercise(db: Db, input: ExerciseInput): Promise<ExerciseRow> {
  const payload: ExercisePayload = {
    exerciseType: input.type,
    date: input.date,
    totalTime: input.totalTime ?? null,
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

export async function listExercises(db: Db): Promise<ExerciseRow[]> {
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.source, "manual"), eq(events.type, "exercise")))
    .orderBy(desc(events.startTs), desc(events.createdAt));
  return rows.map(toRow);
}
