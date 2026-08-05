import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CalendarEvent, ExerciseRow } from "@life/shared";
import { getCalendarEvents, getExercises } from "../api";

// Shared calendar building blocks used by BOTH the full Calendar page and the
// Home "this week" widget, so fetching, grouping, and chip rendering live once.

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const dateKey = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

// "30min gym" when a duration was logged, otherwise just "gym".
export const chipLabel = (e: ExerciseRow) =>
  e.totalTime != null ? `${e.totalTime}min ${e.type}` : e.type;

// "9:30 AM Dentist" for timed events, just the title for all-day ones.
export const eventLabel = (e: CalendarEvent) =>
  e.allDay
    ? e.title
    : `${new Date(e.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} ${e.title}`;

// Calendar events on one local day, split into all-day and timed (timed sorted
// by start). Shares the ["calendar-events"] query — no extra fetch.
export function useCalendarEventsOn(date: string) {
  const events = useQuery({ queryKey: ["calendar-events"], queryFn: getCalendarEvents });
  return useMemo(() => {
    const allDay: CalendarEvent[] = [];
    const timed: CalendarEvent[] = [];
    for (const e of events.data?.events ?? []) {
      const d = new Date(e.start);
      if (dateKey(d.getFullYear(), d.getMonth(), d.getDate()) !== date) continue;
      (e.allDay ? allDay : timed).push(e);
    }
    timed.sort((a, b) => a.start.localeCompare(b.start));
    return { allDay, timed };
  }, [events.data, date]);
}

// Fetches exercises + iCloud events once (React Query dedupes across mounts)
// and groups both by YYYY-MM-DD.
export function useDayData() {
  const exercises = useQuery({ queryKey: ["exercises"], queryFn: getExercises });
  const calEvents = useQuery({ queryKey: ["calendar-events"], queryFn: getCalendarEvents });

  const byDay = useMemo(() => {
    const map = new Map<string, ExerciseRow[]>();
    for (const e of exercises.data?.exercises ?? []) {
      const list = map.get(e.date) ?? [];
      list.push(e);
      map.set(e.date, list);
    }
    return map;
  }, [exercises.data]);

  // iCloud events per local day; the API returns them start-ordered.
  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of calEvents.data?.events ?? []) {
      const d = new Date(e.start);
      const key = dateKey(d.getFullYear(), d.getMonth(), d.getDate());
      const list = map.get(key) ?? [];
      list.push(e);
      map.set(key, list);
    }
    return map;
  }, [calEvents.data]);

  return { byDay, eventsByDay, exercises, calEvents };
}

// The chips for a single day: violet iCloud events first, then blue exercises.
export function DayChips({
  dayEvents,
  entries,
}: {
  dayEvents: CalendarEvent[];
  entries: ExerciseRow[];
}) {
  if (dayEvents.length === 0 && entries.length === 0) return null;
  return (
    <div className="mt-1 space-y-1">
      {dayEvents.map((e) => (
        <div
          key={`cal-${e.id}`}
          title={e.location ?? undefined}
          className="truncate rounded bg-violet-500/15 px-1.5 py-0.5 text-xs text-violet-300 ring-1 ring-inset ring-violet-500/30"
        >
          {eventLabel(e)}
        </div>
      ))}
      {entries.map((e) => (
        <div
          key={e.id}
          title={e.description ?? undefined}
          className="truncate rounded bg-blue-500/15 px-1.5 py-0.5 text-xs text-blue-300 ring-1 ring-inset ring-blue-500/30"
        >
          {chipLabel(e)}
        </div>
      ))}
    </div>
  );
}
