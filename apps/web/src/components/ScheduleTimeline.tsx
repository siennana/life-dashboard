import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CalendarEvent, ExerciseRow } from "@life/shared";
import { getCalendarEvents, getExercises } from "../api";
import { dateKey } from "../lib/calendar";

// The one scrollable 24-hour timeline used by BOTH the expanded-day schedule
// (one column) and the expanded-week scan (seven columns). Because they share
// this, the two always reflect the same schedule — iCloud events (violet) and
// manual exercises (blue) — regardless of expansion state. A mark lands on the
// timeline only with a positionable range (calendar timed events; exercises
// with both a time and a duration); everything else — all-day events, exercises
// missing a time or duration — pins to the sticky top of its column.

const DAY_START_HOUR = 7; // window starts here (7 AM)
const VISIBLE_HOURS = 12; // 7 AM - 7 PM fills the container initially

function hourLabel(hour: number) {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12} ${hour < 12 ? "AM" : "PM"}`;
}
const clockLabel = (d: Date) =>
  d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

// "14:30" -> "2:30 PM".
function timeLabel(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  const h12 = (h ?? 0) % 12 === 0 ? 12 : (h ?? 0) % 12;
  return `${h12}:${String(m ?? 0).padStart(2, "0")} ${(h ?? 0) < 12 ? "AM" : "PM"}`;
}

const exBase = (e: ExerciseRow) => e.description?.trim() || e.type;

// Label for an exercise pinned to the top (no positionable time + duration):
// lead with whatever partial info it has.
function exTopLabel(e: ExerciseRow) {
  if (e.time) return `${timeLabel(e.time)} ${exBase(e)}`;
  if (e.totalTime != null) return `${e.totalTime}min ${e.type}`;
  return exBase(e);
}

type Kind = "event" | "exercise";
type Pinned = { key: string; kind: Kind; label: string; title?: string };
type Block = {
  key: string;
  kind: Kind;
  startMin: number;
  endMin: number;
  timeText: string;
  label: string;
  title?: string;
};
type DayColumn = { pinned: Pinned[]; blocks: Block[] };

const PINNED_CLASS: Record<Kind, string> = {
  event: "bg-violet-500/20 text-violet-200 ring-violet-500/40",
  exercise: "bg-blue-500/20 text-blue-200 ring-blue-500/40",
};
const BLOCK_CLASS: Record<Kind, string> = {
  event: "bg-violet-500/25 text-violet-100 ring-violet-500/50",
  exercise: "bg-blue-500/25 text-blue-100 ring-blue-500/50",
};

// Bucket the day's events + exercises into pinned marks and positioned blocks.
function buildSchedule(
  dates: string[],
  events: CalendarEvent[],
  exercises: ExerciseRow[],
): Map<string, DayColumn> {
  const map = new Map<string, DayColumn>();
  for (const d of dates) map.set(d, { pinned: [], blocks: [] });

  for (const e of events) {
    const dt = new Date(e.start);
    const day = map.get(dateKey(dt.getFullYear(), dt.getMonth(), dt.getDate()));
    if (!day) continue;
    if (e.allDay) {
      day.pinned.push({ key: `cal-${e.id}`, kind: "event", label: e.title, title: e.location ?? undefined });
    } else {
      const start = new Date(e.start);
      const startMin = start.getHours() * 60 + start.getMinutes();
      const end = e.end ? new Date(e.end) : new Date(start.getTime() + 30 * 60_000);
      let endMin = end.getHours() * 60 + end.getMinutes();
      // Clamp to same-day and guarantee a visible minimum block.
      if (endMin <= startMin) endMin = Math.min(startMin + 30, 24 * 60);
      day.blocks.push({
        key: `cal-${e.id}`,
        kind: "event",
        startMin,
        endMin,
        timeText: clockLabel(start),
        label: e.title,
        title: e.location ?? undefined,
      });
    }
  }

  for (const ex of exercises) {
    const day = map.get(ex.date);
    if (!day) continue;
    const positionable = ex.time != null && ex.totalTime != null && ex.totalTime > 0;
    if (positionable) {
      const [h, m] = ex.time!.split(":").map(Number);
      const startMin = (h ?? 0) * 60 + (m ?? 0);
      const endMin = Math.min(startMin + ex.totalTime!, 24 * 60);
      day.blocks.push({
        key: `ex-${ex.id}`,
        kind: "exercise",
        startMin,
        endMin,
        timeText: timeLabel(ex.time!),
        label: exBase(ex),
        title: ex.description ?? undefined,
      });
    } else {
      day.pinned.push({ key: `ex-${ex.id}`, kind: "exercise", label: exTopLabel(ex), title: ex.description ?? undefined });
    }
  }

  for (const day of map.values()) day.blocks.sort((a, b) => a.startMin - b.startMin);
  return map;
}

const MIN_BLOCK_PX = 15; // floor so a short event (e.g. a 15min run) stays visible
const BLOCK_GAP_PX = 1; // hairline surface gap between back-to-back blocks

// Pixel top/height per block, in the same order as `blocks` (already sorted by
// startMin). The MIN_BLOCK_PX floor can make a short event's raw height exceed
// its real duration; capping each block's bottom to the next block's top keeps
// that floor from bleeding into (visually overlapping) whatever follows it —
// e.g. a 12:30 event lasting 15min butting right up against a 12:45 event.
function layoutBlocks(blocks: Block[], hourH: number): { top: number; height: number }[] {
  const raw = blocks.map((b) => ({
    top: (b.startMin / 60) * hourH,
    height: Math.max(((b.endMin - b.startMin) / 60) * hourH, MIN_BLOCK_PX),
  }));
  for (let i = 0; i < raw.length - 1; i++) {
    const cur = raw[i]!;
    const nextTop = raw[i + 1]!.top;
    const maxBottom = nextTop - BLOCK_GAP_PX;
    if (cur.top + cur.height > maxBottom) {
      cur.height = Math.max(maxBottom - cur.top, 4); // never fully collapse
    }
  }
  return raw;
}

export function ScheduleTimeline({
  dates,
  gutter,
  className = "",
  onDateContextMenu,
}: {
  dates: string[];
  gutter: number; // left gutter (px) reserved for the hour labels
  className?: string; // extra classes for the scroll container (sizing)
  onDateContextMenu?: (e: React.MouseEvent, date: string) => void;
}) {
  const events = useQuery({ queryKey: ["calendar-events"], queryFn: getCalendarEvents });
  const exercises = useQuery({ queryKey: ["exercises"], queryFn: getExercises });
  const datesKey = dates.join(",");
  const byDate = useMemo(
    () => buildSchedule(dates, events.data?.events ?? [], exercises.data?.exercises ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events.data, exercises.data, datesKey],
  );

  // Denser type in the multi-column (week) layout, where columns are narrow.
  const dense = dates.length > 1;
  const pinnedText = dense ? "px-1 py-px text-[9px]" : "px-1.5 py-0.5 text-[10px]";
  const blockText = dense ? "text-[9px]" : "text-[10px]";
  const colBorder = dense ? "border-l border-zinc-700/40" : "";

  const scrollRef = useRef<HTMLDivElement>(null);
  const [hourH, setHourH] = useState(40);

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

  const anyPinned = dates.some((d) => (byDate.get(d)?.pinned.length ?? 0) > 0);

  return (
    <div
      ref={scrollRef}
      // Don't collapse the expanded day/week when scrolling/clicking the schedule.
      onClick={(e) => e.stopPropagation()}
      className={`overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900/40 ${className}`}
    >
      {anyPinned && (
        <div className="sticky top-0 z-10 flex border-b border-zinc-700 bg-zinc-800">
          <div style={{ width: gutter }} className="shrink-0" />
          {dates.map((d) => (
            <div key={d} className={`min-w-0 flex-1 space-y-0.5 p-0.5 ${dense ? "border-l border-zinc-700/50" : ""}`}>
              {(byDate.get(d)?.pinned ?? []).map((it) => (
                <div
                  key={it.key}
                  title={it.title}
                  className={`truncate rounded ring-1 ring-inset ${pinnedText} ${PINNED_CLASS[it.kind]}`}
                >
                  {it.label}
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
            className={`relative min-w-0 flex-1 ${colBorder}`}
          >
            {(() => {
              const blocks = byDate.get(d)?.blocks ?? [];
              const laidOut = layoutBlocks(blocks, hourH);
              return blocks.map((b, i) => (
                <div
                  key={b.key}
                  title={b.title}
                  style={laidOut[i]}
                  className={`absolute inset-x-0.5 overflow-hidden rounded px-1 leading-tight ring-1 ring-inset ${blockText} ${BLOCK_CLASS[b.kind]}`}
                >
                  <span className="font-medium">{b.timeText}</span> {b.label}
                </div>
              ));
            })()}
          </div>
        ))}
      </div>
    </div>
  );
}
