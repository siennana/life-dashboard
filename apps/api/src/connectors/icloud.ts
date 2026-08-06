import { and, eq, gte, lte, notInArray } from "drizzle-orm";
import { createDAVClient } from "tsdav";
import ical, { type VEvent } from "node-ical";
import { events, syncRuns, type Db } from "@life/db";

// Read-only pull from iCloud over CalDAV (app-specific password — never public
// ICS links, since events can carry locations). We sync a rolling window and
// prune anything in the window that iCloud no longer reports.
const PAST_DAYS = 90;
const FUTURE_DAYS = 365;

type NormalizedEvent = {
  externalId: string;
  title: string;
  start: Date;
  end: Date | null;
  allDay: boolean;
  calendar: string;
  location: string | null;
};

function windowRange(): { start: Date; end: Date } {
  const now = Date.now();
  return {
    start: new Date(now - PAST_DAYS * 86400_000),
    end: new Date(now + FUTURE_DAYS * 86400_000),
  };
}

// node-ical text fields are string | { params, val } — unwrap to plain text.
function text(v: unknown): string | null {
  if (typeof v === "string") return v || null;
  if (v && typeof v === "object" && "val" in v) return String((v as { val: unknown }).val) || null;
  return null;
}

// Expand one VEVENT into concrete occurrences inside the window. Handles
// single events, RRULE recurrences, EXDATE exclusions, and per-instance
// overrides (a moved/renamed occurrence).
function expandEvent(
  ev: VEvent,
  calendarName: string,
  winStart: Date,
  winEnd: Date,
): NormalizedEvent[] {
  const uid = ev.uid ?? `${calendarName}:${ev.summary}:${Number(ev.start)}`;
  const allDay = ev.datetype === "date";
  const durationMs =
    ev.end && ev.start ? new Date(ev.end).getTime() - new Date(ev.start).getTime() : 0;
  const base = {
    title: text(ev.summary) ?? "(untitled)",
    allDay,
    calendar: calendarName,
    location: text(ev.location),
  };

  if (!ev.rrule) {
    const start = new Date(ev.start);
    if (start > winEnd || start < winStart) return [];
    return [{ externalId: uid, start, end: ev.end ? new Date(ev.end) : null, ...base }];
  }

  const out: NormalizedEvent[] = [];
  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  const exdates = new Set(Object.keys(ev.exdate ?? {}));
  // Cast: node-ical's Omit<VEvent,...> degrades to `unknown` fields because
  // VEvent includes a Record<string, unknown> index signature.
  const recurrences = (ev.recurrences ?? {}) as Record<string, VEvent | undefined>;

  for (const occurrence of ev.rrule.between(winStart, winEnd, true)) {
    const key = dayKey(occurrence);
    if (exdates.has(key)) continue;
    const override = recurrences[key];
    const start = override?.start ? new Date(override.start) : occurrence;
    const end =
      override?.end != null
        ? new Date(override.end)
        : durationMs > 0
          ? new Date(start.getTime() + durationMs)
          : null;
    out.push({
      ...base,
      externalId: `${uid}:${occurrence.toISOString()}`,
      title: text(override?.summary) ?? base.title,
      location: text(override?.location) ?? base.location,
      start,
      end,
    });
  }
  return out;
}

export async function syncICloud(db: Db, email: string, appPassword: string) {
  const run = (await db.insert(syncRuns).values({ source: "calendar" }).returning())[0]!;
  try {
    const client = await createDAVClient({
      serverUrl: "https://caldav.icloud.com",
      credentials: { username: email, password: appPassword },
      authMethod: "Basic",
      defaultAccountType: "caldav",
    });

    const { start, end } = windowRange();
    const calendars = await client.fetchCalendars();
    const normalized: NormalizedEvent[] = [];

    for (const cal of calendars) {
      // Skip reminder/task collections — we only want event calendars.
      const components = (cal.components ?? []) as string[];
      if (components.length > 0 && !components.includes("VEVENT")) continue;
      const calendarName = typeof cal.displayName === "string" ? cal.displayName : "calendar";

      const objects = await client.fetchCalendarObjects({
        calendar: cal,
        timeRange: { start: start.toISOString(), end: end.toISOString() },
      });
      for (const obj of objects) {
        if (!obj.data) continue;
        const parsed = ical.sync.parseICS(obj.data);
        for (const item of Object.values(parsed)) {
          if (item?.type !== "VEVENT") continue;
          normalized.push(...expandEvent(item as VEvent, calendarName, start, end));
        }
      }
    }

    for (const e of normalized) {
      const payload = {
        allDay: e.allDay,
        calendar: e.calendar,
        location: e.location,
      };
      await db
        .insert(events)
        .values({
          source: "calendar",
          externalId: e.externalId,
          type: "calendar-event",
          title: e.title,
          startTs: e.start,
          endTs: e.end,
          payload,
        })
        .onConflictDoUpdate({
          target: [events.source, events.externalId],
          set: { title: e.title, startTs: e.start, endTs: e.end, payload, updatedAt: new Date() },
        });
    }

    // Anything stored in the window that iCloud no longer returned was
    // deleted or moved — drop it.
    const activeIds = normalized.map((e) => e.externalId);
    await db
      .delete(events)
      .where(
        and(
          eq(events.source, "calendar"),
          eq(events.type, "calendar-event"),
          gte(events.startTs, start),
          lte(events.startTs, end),
          activeIds.length > 0 ? notInArray(events.externalId, activeIds) : undefined,
        ),
      );

    await db
      .update(syncRuns)
      .set({ finishedAt: new Date(), status: "ok" })
      .where(eq(syncRuns.id, run.id));
    return { ok: true, events: normalized.length, calendars: calendars.length };
  } catch (err) {
    await db
      .update(syncRuns)
      .set({ finishedAt: new Date(), status: "error", error: String(err) })
      .where(eq(syncRuns.id, run.id));
    throw err;
  }
}
