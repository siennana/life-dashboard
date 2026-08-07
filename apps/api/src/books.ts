import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { events, type Db } from "@life/db";
import type { BookInput, BookRow, BookStatus } from "@life/shared";

// Manually logged books live in the generic `events` table: source "manual",
// type "book". The events.title column holds the book title; everything else
// book-specific lives in the payload.
type BookPayload = {
  author: string | null;
  rating: number | null;
  log: string | null;
  dateStarted: string | null;
  dateCompleted: string | null;
  status: BookStatus;
};

function toRow(row: typeof events.$inferSelect): BookRow {
  const p = (row.payload ?? {}) as Partial<BookPayload>;
  return {
    id: row.id,
    title: row.title ?? "",
    author: p.author ?? null,
    rating: p.rating ?? null,
    log: p.log ?? null,
    dateStarted: p.dateStarted ?? null,
    dateCompleted: p.dateCompleted ?? null,
    status: p.status ?? "queued",
    createdAt: row.createdAt.toISOString(),
  };
}

export async function createBook(db: Db, input: BookInput): Promise<BookRow> {
  const payload: BookPayload = {
    author: input.author ?? null,
    rating: input.rating ?? null,
    log: input.log ?? null,
    dateStarted: input.dateStarted ?? null,
    dateCompleted: input.dateCompleted ?? null,
    status: input.status,
  };
  const row = (
    await db
      .insert(events)
      .values({
        source: "manual",
        externalId: randomUUID(),
        type: "book",
        title: input.title,
        // Anchor on the start date when there is one (noon UTC keeps the
        // calendar day stable across timezones); queued books use "now".
        startTs: input.dateStarted ? new Date(`${input.dateStarted}T12:00:00Z`) : new Date(),
        payload,
      })
      .returning()
  )[0]!;
  return toRow(row);
}

// Full-replace edit: the form resubmits every editable field, so omitted
// optionals clear. Returns null when the id isn't a manual book row.
export async function updateBook(db: Db, id: number, input: BookInput): Promise<BookRow | null> {
  const payload: BookPayload = {
    author: input.author ?? null,
    rating: input.rating ?? null,
    log: input.log ?? null,
    dateStarted: input.dateStarted ?? null,
    dateCompleted: input.dateCompleted ?? null,
    status: input.status,
  };
  const rows = await db
    .update(events)
    .set({
      title: input.title,
      payload,
      updatedAt: new Date(),
      ...(input.dateStarted
        ? { startTs: new Date(`${input.dateStarted}T12:00:00Z`) }
        : {}),
    })
    .where(and(eq(events.id, id), eq(events.source, "manual"), eq(events.type, "book")))
    .returning();
  return rows[0] ? toRow(rows[0]) : null;
}

// Delete a manual book row. Returns false when the id isn't a manual book (so
// the route can 404 rather than silently succeed).
export async function deleteBook(db: Db, id: number): Promise<boolean> {
  const deleted = await db
    .delete(events)
    .where(and(eq(events.id, id), eq(events.source, "manual"), eq(events.type, "book")))
    .returning({ id: events.id });
  return deleted.length > 0;
}

export async function listBooks(db: Db): Promise<BookRow[]> {
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.source, "manual"), eq(events.type, "book")));
  // Completion date descending; unfinished books (no completion date) sort
  // above everything — the current read is the most recent activity.
  return rows.map(toRow).sort((a, b) => {
    if (a.dateCompleted !== b.dateCompleted) {
      if (a.dateCompleted == null) return -1;
      if (b.dateCompleted == null) return 1;
      return b.dateCompleted.localeCompare(a.dateCompleted);
    }
    return b.createdAt.localeCompare(a.createdAt);
  });
}
