import { asc, eq, and, sql } from "drizzle-orm";
import { eventTags, tagRules, tags, type Db } from "@life/db";
import { TAG_COLORS, type Tag, type TagUpdateInput } from "@life/shared";
import { merchantKeyOf, normalizeMerchant } from "./spending";

// User-defined merchant labels. Tags are pure data (no per-label logic);
// rules key on the normalized merchant key so they survive Plaid re-links.
// All writes autosave from the editor drawer - no batching, tiny tables.

const toTag = (r: typeof tags.$inferSelect): Tag => ({
  id: r.id,
  name: r.name,
  color: (TAG_COLORS as readonly string[]).includes(r.color) ? (r.color as Tag["color"]) : "zinc",
});

export async function listTags(db: Db): Promise<Tag[]> {
  const [rows, rules, eventRows] = await Promise.all([
    db.select().from(tags).orderBy(asc(tags.name)),
    db.select({ tagId: tagRules.tagId }).from(tagRules),
    db.select({ tagId: eventTags.tagId }).from(eventTags),
  ]);
  const counts = new Map<number, number>();
  for (const r of rules) counts.set(r.tagId, (counts.get(r.tagId) ?? 0) + 1);
  const eventCounts = new Map<number, number>();
  for (const r of eventRows) eventCounts.set(r.tagId, (eventCounts.get(r.tagId) ?? 0) + 1);
  return rows.map((r) => ({
    ...toTag(r),
    merchants: counts.get(r.id) ?? 0,
    events: eventCounts.get(r.id) ?? 0,
  }));
}

// Create by name; re-creating an existing name returns the existing tag
// (idempotent - the add input doesn't need an "already exists" error state).
// New tags cycle through the palette so each lands on a different color.
export async function createTag(db: Db, name: string): Promise<Tag> {
  const existing = await db
    .select()
    .from(tags)
    .where(sql`lower(${tags.name}) = ${name.toLowerCase()}`);
  if (existing[0]) return toTag(existing[0]);
  const count = (await db.select({ id: tags.id }).from(tags)).length;
  const rows = await db
    .insert(tags)
    .values({ name, color: TAG_COLORS[count % TAG_COLORS.length]! })
    .returning();
  return toTag(rows[0]!);
}

export async function updateTag(db: Db, id: number, patch: TagUpdateInput): Promise<Tag | null> {
  const set: Partial<typeof tags.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.color !== undefined) set.color = patch.color;
  const rows = await db.update(tags).set(set).where(eq(tags.id, id)).returning();
  return rows[0] ? toTag(rows[0]) : null;
}

// Rules go with the tag (FK cascade).
export async function deleteTag(db: Db, id: number): Promise<boolean> {
  const rows = await db.delete(tags).where(eq(tags.id, id)).returning();
  return rows.length > 0;
}

// Flip a tag on/off for a merchant (the row menu's checkbox). Returns the new
// state. Merchant display name is normalized so raw statement descriptors
// store as their brand.
export async function toggleTagMerchant(
  db: Db,
  tagId: number,
  rawMerchant: string,
): Promise<{ tagged: boolean } | null> {
  const tag = (await db.select().from(tags).where(eq(tags.id, tagId)))[0];
  if (!tag) return null;
  const merchant = normalizeMerchant(rawMerchant.trim());
  const merchantKey = merchantKeyOf(merchant);
  const deleted = await db
    .delete(tagRules)
    .where(and(eq(tagRules.tagId, tagId), eq(tagRules.merchantKey, merchantKey)))
    .returning();
  if (deleted.length > 0) return { tagged: false };
  await db.insert(tagRules).values({ tagId, merchant, merchantKey });
  return { tagged: true };
}

// Flip a tag on/off for one calendar event (the event context menu's
// checkboxes). Keyed on the event's CalDAV externalId - per occurrence, not
// per series - because that's the only handle the 5-min sync cycle preserves.
export async function toggleTagEvent(
  db: Db,
  tagId: number,
  externalId: string,
): Promise<{ tagged: boolean } | null> {
  const tag = (await db.select().from(tags).where(eq(tags.id, tagId)))[0];
  if (!tag) return null;
  const deleted = await db
    .delete(eventTags)
    .where(and(eq(eventTags.tagId, tagId), eq(eventTags.eventExternalId, externalId)))
    .returning();
  if (deleted.length > 0) return { tagged: false };
  await db.insert(eventTags).values({ tagId, eventExternalId: externalId });
  return { tagged: true };
}

// All event-tag assignments grouped by event externalId, for decorating the
// calendar events response. Tags sorted by name for stable chip order.
export async function eventTagsByExternalId(db: Db): Promise<Map<string, Tag[]>> {
  const rows = await db
    .select({ externalId: eventTags.eventExternalId, tag: tags })
    .from(eventTags)
    .innerJoin(tags, eq(eventTags.tagId, tags.id))
    .orderBy(asc(tags.name));
  const map = new Map<string, Tag[]>();
  for (const r of rows) {
    const list = map.get(r.externalId) ?? [];
    list.push(toTag(r.tag));
    map.set(r.externalId, list);
  }
  return map;
}
