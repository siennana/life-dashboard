import { useEffect, useRef, useState } from "react";
import { useCalendarEventsOn } from "../lib/calendar";

const DAY_START_HOUR = 7; // window starts here (7 AM)
const VISIBLE_HOURS = 12; // 7 AM - 7 PM fills the container initially

// "7 AM", "12 PM", "1 PM" for an hour-of-day 0..23.
function hourLabel(hour: number) {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12} ${hour < 12 ? "AM" : "PM"}`;
}
const clockLabel = (d: Date) =>
  d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

// A scrollable 24-hour timeline. Hour height is sized so 7 AM - 7 PM exactly
// fills the container; it opens scrolled to 7 AM. Timed events are positioned
// by start/end; all-day events pin to the top (sticky) while scrolling.
// `showLabel` toggles the "Schedule" heading (off in the tight week-scan view).
export function DaySchedule({ date, showLabel = true }: { date: string; showLabel?: boolean }) {
  const { allDay, timed } = useCalendarEventsOn(date);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hourH, setHourH] = useState(40);

  // Measure after the expand animation settles, size hours to fit 7 AM - 7 PM.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const t = setTimeout(() => {
      if (el.clientHeight > 0) setHourH(el.clientHeight / VISIBLE_HOURS);
    }, 320);
    return () => clearTimeout(t);
  }, [date]);

  // Scroll to 7 AM once the hour size is known.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = DAY_START_HOUR * hourH;
  }, [hourH, date]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {showLabel && (
        <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
          Schedule
        </span>
      )}
      <div
        ref={scrollRef}
        // Don't collapse the expanded day when scrolling/clicking the schedule.
        onClick={(e) => e.stopPropagation()}
        className={`min-h-16 flex-1 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900/40 ${
          showLabel ? "mt-1" : ""
        }`}
      >
        {allDay.length > 0 && (
          <div className="sticky top-0 z-10 space-y-0.5 border-b border-zinc-700 bg-zinc-800 p-1">
            {allDay.map((e) => (
              <div
                key={e.id}
                title={e.location ?? undefined}
                className="truncate rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] text-violet-200 ring-1 ring-inset ring-violet-500/40"
              >
                {e.title}
              </div>
            ))}
          </div>
        )}
        <div className="relative" style={{ height: 24 * hourH }}>
          {Array.from({ length: 24 }, (_, h) => (
            <div
              key={h}
              className="absolute inset-x-0 border-t border-zinc-700/40"
              style={{ top: h * hourH }}
            >
              <span className="absolute left-1 top-0 text-[9px] leading-none text-zinc-600">
                {hourLabel(h)}
              </span>
            </div>
          ))}
          {timed.map((e) => {
            const start = new Date(e.start);
            const startMin = start.getHours() * 60 + start.getMinutes();
            const end = e.end ? new Date(e.end) : new Date(start.getTime() + 30 * 60_000);
            let endMin = end.getHours() * 60 + end.getMinutes();
            // Clamp to same-day and guarantee a visible minimum block.
            if (endMin <= startMin) endMin = Math.min(startMin + 30, 24 * 60);
            const top = (startMin / 60) * hourH;
            const height = Math.max(((endMin - startMin) / 60) * hourH, 15);
            return (
              <div
                key={e.id}
                title={e.location ?? undefined}
                style={{ top, height }}
                className="absolute left-9 right-1 overflow-hidden rounded bg-violet-500/25 px-1.5 py-0.5 text-[10px] leading-tight text-violet-100 ring-1 ring-inset ring-violet-500/50"
              >
                <span className="font-medium">{clockLabel(start)}</span> {e.title}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
