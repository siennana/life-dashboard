import { eq } from "drizzle-orm";
import { events, syncRuns, type Db } from "@life/db";
import { thingsPushSchema } from "@life/shared";

// Snapshot ingest: the iOS Shortcut pushes the current state of (a subset of)
// todos; we upsert on (source, external_id) and never delete — the payload's
// `status` field is what the UI filters on.
export async function ingestThingsPush(db: Db, body: unknown) {
  const push = thingsPushSchema.parse(body);
  const run = (await db.insert(syncRuns).values({ source: "things" }).returning())[0]!;

  try {
    for (const todo of push.todos) {
      const startTs = todo.dueDate ? new Date(todo.dueDate) : new Date();
      await db
        .insert(events)
        .values({
          source: "things",
          externalId: todo.id,
          type: "todo",
          title: todo.title,
          startTs,
          payload: todo,
        })
        .onConflictDoUpdate({
          target: [events.source, events.externalId],
          set: { title: todo.title, startTs, payload: todo, updatedAt: new Date() },
        });
    }
    await db
      .update(syncRuns)
      .set({ finishedAt: new Date(), status: "ok" })
      .where(eq(syncRuns.id, run.id));
    return { ok: true, received: push.todos.length };
  } catch (err) {
    await db
      .update(syncRuns)
      .set({ finishedAt: new Date(), status: "error", error: String(err) })
      .where(eq(syncRuns.id, run.id));
    throw err;
  }
}
