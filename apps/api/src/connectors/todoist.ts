import { and, eq, notInArray, sql } from "drizzle-orm";
import { events, syncRuns, type Db } from "@life/db";

const API = "https://api.todoist.com/api/v1";

type TodoistTask = {
  id: string;
  content: string;
  description?: string;
  project_id?: string;
  due?: { date: string } | null;
  added_at?: string;
  [key: string]: unknown;
};

type TodoistProject = { id: string; name: string };

async function fetchAll<T>(path: string, token: string): Promise<T[]> {
  const results: T[] = [];
  let cursor: string | null = null;
  do {
    const url = new URL(`${API}${path}`);
    url.searchParams.set("limit", "200");
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Todoist ${path} failed: ${res.status}`);
    const body = (await res.json()) as { results: T[]; next_cursor: string | null };
    results.push(...body.results);
    cursor = body.next_cursor;
  } while (cursor);
  return results;
}

export async function syncTodoist(db: Db, token: string) {
  const run = (await db.insert(syncRuns).values({ source: "todoist" }).returning())[0]!;
  try {
    const [projects, tasks] = await Promise.all([
      fetchAll<TodoistProject>("/projects", token),
      fetchAll<TodoistTask>("/tasks", token),
    ]);
    const projectNames = new Map(projects.map((p) => [p.id, p.name]));

    for (const task of tasks) {
      const startTs = task.due?.date
        ? new Date(task.due.date)
        : new Date(task.added_at ?? Date.now());
      const payload = {
        ...task,
        status: "open",
        list: task.project_id ? (projectNames.get(task.project_id) ?? null) : null,
      };
      await db
        .insert(events)
        .values({
          source: "todoist",
          externalId: task.id,
          type: "todo",
          title: task.content,
          startTs,
          payload,
        })
        .onConflictDoUpdate({
          target: [events.source, events.externalId],
          set: { title: task.content, startTs, payload, updatedAt: new Date() },
        });
    }

    // Anything locally open that's no longer in the active set was completed
    // (or deleted) in Todoist.
    const activeIds = tasks.map((t) => t.id);
    await db
      .update(events)
      .set({
        payload: sql`jsonb_set(payload, '{status}', '"completed"')`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(events.source, "todoist"),
          eq(events.type, "todo"),
          sql`payload->>'status' = 'open'`,
          activeIds.length > 0 ? notInArray(events.externalId, activeIds) : undefined,
        ),
      );

    await db
      .update(syncRuns)
      .set({ finishedAt: new Date(), status: "ok" })
      .where(eq(syncRuns.id, run.id));
    return { ok: true, tasks: tasks.length };
  } catch (err) {
    await db
      .update(syncRuns)
      .set({ finishedAt: new Date(), status: "error", error: String(err) })
      .where(eq(syncRuns.id, run.id));
    throw err;
  }
}

// Write-back: complete a task in Todoist, then mirror it locally.
export async function closeTodoistTask(db: Db, token: string, externalId: string) {
  const res = await fetch(`${API}/tasks/${externalId}/close`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Todoist close failed: ${res.status}`);
  await db
    .update(events)
    .set({
      payload: sql`jsonb_set(payload, '{status}', '"completed"')`,
      updatedAt: new Date(),
    })
    .where(and(eq(events.source, "todoist"), eq(events.externalId, externalId)));
  return { ok: true };
}
