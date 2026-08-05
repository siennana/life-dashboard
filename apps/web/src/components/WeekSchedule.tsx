import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CalendarEvent } from "@life/shared";
import { getCalendarEvents } from "../api";
import { dateKey } from "../lib/calendar";

const DAY_START_HOUR = 7; // window starts here (7 AM)
const VISIBLE_HOURS = 12; // 7 AM - 7 PM fills the container initially

function hourLabel(hour: number) {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12} ${hour < 12 ? "AM" : "PM"}`;
}
const clockLabel = (d: Date) =>
  d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

type DayBucket = { allDay: CalendarEvent[]; timed: CalendarEvent[] };

// One scrollable timeline shared across a whole week (7 columns) so the entire
// week scrolls together under a single scrollbar. Hour labels live in a left
// gutter; all-day events pin to the top of each column.
export function WeekSchedule({
  dates,
  gutter,
  onDateContextMenu,
}: {
  dates: string[];
  gutter: number;
  onDateContextMenu?: (e: React.MouseEvent, date: string) => void;
}) {
  const events = useQuery({ queryKey: ["calendar-events"], queryFn: getCalendarEvents });
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hourH, setHourH] = useState(40);
  const datesKey = dates.join(",");

  const byDate = useMemo(() => {
    const map = new Map<string, DayBucket>();
    for (const d of dates) map.set(d, { allDay: [], timed: [] });
    for (const e of events.data?.events ?? []) {
      const dt = new Date(e.start);
      const bucket = map.get(dateKey(dt.getFullYear(), dt.getMonth(), dt.getDate()));
      if (!bucket) continue;
      (e.allDay ? bucket.allDay : bucket.timed).push(e);
    }
    for (const b of map.values()) b.timed.sort((a, z) => a.start.localeCompare(z.start));
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events.data, datesKey]);

  const anyAllDay = dates.some((d) => (byDate.get(d)?.allDay.length ?? 0) > 0);

  // Size hours so 7 AM - 7 PM fills the container, measured after the animation.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const t = setTimeout(() => {
      if (el.clientHeight > 0) setHourH(el.clientHeight / VISIBLE_HOURS);
    }, 320);
    return () => clearTimeout(t);
  }, [datesKey]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = DAY_START_HOUR * hourH;
  }, [hourH, datesKey]);

  return (
    <div
      ref={scrollRef}
      onClick={(e) => e.stopPropagation()}
      className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900/40"
    >
      {anyAllDay && (
        <div className="sticky top-0 z-10 flex border-b border-zinc-700 bg-zinc-800">
          <div style={{ width: gutter }} className="shrink-0" />
          {dates.map((d) => (
            <div key={d} className="min-w-0 flex-1 space-y-0.5 border-l border-zinc-700/50 p-0.5">
              {(byDate.get(d)?.allDay ?? []).map((e) => (
                <div
                  key={e.id}
                  title={e.location ?? undefined}
                  className="truncate rounded bg-violet-500/20 px-1 py-px text-[9px] text-violet-200"
                >
                  {e.title}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      <div className="relative flex" style={{ height: 24 * hourH }}>
        {/* Hour lines + labels span the full width behind all columns. */}
        {Array.from({ length: 24 }, (_, h) => (
          <div
            key={h}
            className="pointer-events-none absolute inset-x-0 border-t border-zinc-700/40"
            style={{ top: h * hourH }}
          >
            <span className="absolute left-1 top-0 text-[9px] leading-none text-zinc-600">
              {hourLabel(h)}
            </span>
          </div>
        ))}
        <div style={{ width: gutter }} className="shrink-0" />
        {dates.map((d) => (
          <div
            key={d}
            onContextMenu={onDateContextMenu ? (e) => onDateContextMenu(e, d) : undefined}
            className="relative min-w-0 flex-1 border-l border-zinc-700/40"
          >
            {(byDate.get(d)?.timed ?? []).map((e) => {
              const start = new Date(e.start);
              const startMin = start.getHours() * 60 + start.getMinutes();
              const end = e.end ? new Date(e.end) : new Date(start.getTime() + 30 * 60_000);
              let endMin = end.getHours() * 60 + end.getMinutes();
              if (endMin <= startMin) endMin = Math.min(startMin + 30, 24 * 60);
              const top = (startMin / 60) * hourH;
              const height = Math.max(((endMin - startMin) / 60) * hourH, 15);
              return (
                <div
                  key={e.id}
                  title={e.location ?? undefined}
                  style={{ top, height }}
                  className="absolute inset-x-0.5 overflow-hidden rounded bg-violet-500/25 px-1 text-[9px] leading-tight text-violet-100 ring-1 ring-inset ring-violet-500/50"
                >
                  <span className="font-medium">{clockLabel(start)}</span> {e.title}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
