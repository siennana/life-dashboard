import { useRef, useState } from "react";
import { TipBox, type Tip } from "../lib/finance";

// GitHub-style contribution heatmap, data-agnostic: feed it any per-day
// series ({date, value}) and it renders weeks-as-columns cells shaded by
// magnitude (sequential ramp of the app's chart accent — monotonic lightness
// on the dark surface; exact values ride in the hover tooltip, so magnitude is
// never color-alone). First consumer is the GitHub commit graph on Home;
// exercise/todos/day-log series can reuse it as-is with their own tooltip
// formatter.

export type HeatmapDay = { date: string; value: number };

// Empty cell + 4 intensity steps, low→high (dark→bright on the dark surface).
const EMPTY = "#27272a";
const LEVELS = ["#1d4373", "#2a62ad", "#3987e5", "#85b8f2"];

const CELL = 11; // px in viewBox units
const GAP = 2; // 2px surface gap between fills, per the chart system
const STEP = CELL + GAP;
const GUTTER_L = 28; // weekday labels
const GUTTER_T = 14; // month labels

// Monday-start rows, matching the app's calendars (GitHub itself is
// Sunday-start; consistency with our own grids wins).
const ROW_LABELS = ["Mon", "", "Wed", "", "Fri", "", ""];

const localDate = (d: Date) => d.toLocaleDateString("en-CA"); // YYYY-MM-DD

function tooltipDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function Heatmap({
  days,
  weeks = 52,
  formatValue = (v) => String(v),
  selectedDate,
  onSelectDay,
}: {
  days: HeatmapDay[];
  weeks?: number;
  // Tooltip headline for a day's value ("3 contributions").
  formatValue?: (value: number) => string;
  // Optional selection (Projects day detail): the selected cell gets an ink
  // outline; clicks report the cell's date. Omit both for a passive heatmap.
  selectedDate?: string | null;
  onSelectDay?: (date: string) => void;
}) {
  const [tip, setTip] = useState<Tip>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const byDate = new Map(days.map((d) => [d.date, d.value]));

  // Last column = the current (partial) week; walk back to its Monday.
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const start = new Date(monday);
  start.setDate(monday.getDate() - (weeks - 1) * 7);

  const max = Math.max(...days.map((d) => d.value), 1);
  const level = (v: number) => (v <= 0 ? -1 : Math.min(3, Math.floor(((v - 1) / max) * 4)));

  type Cell = { date: string; value: number | null; week: number; row: number };
  const cells: Cell[] = [];
  const monthLabels: { week: number; label: string }[] = [];
  let prevMonth = -1;
  for (let w = 0; w < weeks; w++) {
    const colMonday = new Date(start);
    colMonday.setDate(start.getDate() + w * 7);
    // Label a column when its Monday enters a new month (skip a cramped first
    // label right at the edge unless it's the very first column).
    if (colMonday.getMonth() !== prevMonth) {
      monthLabels.push({
        week: w,
        label: colMonday.toLocaleDateString(undefined, { month: "short" }),
      });
      prevMonth = colMonday.getMonth();
    }
    for (let r = 0; r < 7; r++) {
      const d = new Date(colMonday);
      d.setDate(colMonday.getDate() + r);
      if (d > today) continue; // future days in the current week: no cell
      const date = localDate(d);
      cells.push({ date, value: byDate.get(date) ?? null, week: w, row: r });
    }
  }

  const W = GUTTER_L + weeks * STEP;
  const H = GUTTER_T + 7 * STEP;

  function showTip(e: React.PointerEvent, c: Cell) {
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTip({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      lines: [c.value == null ? "No data" : formatValue(c.value), tooltipDate(c.date)],
    });
  }

  return (
    <div ref={boxRef} className="relative">
      <TipBox tip={tip} />
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-3 w-full"
        role="img"
        aria-label="Daily activity heatmap"
      >
        {monthLabels.map((m) => (
          <text
            key={`${m.label}-${m.week}`}
            x={GUTTER_L + m.week * STEP}
            y={GUTTER_T - 5}
            fontSize={9}
            fill="#898781"
          >
            {m.label}
          </text>
        ))}
        {ROW_LABELS.map((label, r) =>
          label ? (
            <text
              key={label}
              x={GUTTER_L - 6}
              y={GUTTER_T + r * STEP + CELL - 2.5}
              textAnchor="end"
              fontSize={9}
              fill="#898781"
            >
              {label}
            </text>
          ) : null,
        )}
        {cells.map((c) => (
          <rect
            key={c.date}
            x={GUTTER_L + c.week * STEP}
            y={GUTTER_T + c.row * STEP}
            width={CELL}
            height={CELL}
            rx={2.5}
            fill={c.value == null || level(c.value) < 0 ? EMPTY : LEVELS[level(c.value)]}
            stroke={selectedDate === c.date ? "#f4f4f5" : "none"}
            strokeWidth={selectedDate === c.date ? 1.5 : 0}
            onPointerMove={(e) => showTip(e, c)}
            onPointerLeave={() => setTip(null)}
            onClick={onSelectDay ? () => onSelectDay(c.date) : undefined}
          />
        ))}
      </svg>
      {/* ramp legend — the no-hover magnitude reference */}
      <div className="mt-2 flex items-center justify-end gap-1 text-xs text-zinc-500">
        <span>Less</span>
        {[EMPTY, ...LEVELS].map((color) => (
          <span
            key={color}
            className="inline-block h-2.5 w-2.5"
            // inline radius: an arbitrary rounded-[..] class in a NEW file
            // wouldn't be generated until the dev server restarts
            style={{ background: color, borderRadius: 2.5 }}
          />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}
