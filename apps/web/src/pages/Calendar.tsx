import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getWeather, togglePeriodDay } from "../api";
import { DayChips, dateKey, useDayData, WEEKDAYS } from "../lib/calendar";
import { weatherEmoji } from "../lib/weather";
import { usePeriodDays } from "../lib/period";
import { DayForm } from "../components/DayForm";
import { DayLog } from "../components/DayLog";
import { WeekSchedule } from "../components/WeekSchedule";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// One cell of the 6x7 grid; `inMonth` is false for the dimmed lead-in/lead-out
// days of the previous/next month.
type Cell = { year: number; month: number; day: number; inMonth: boolean };

function buildGrid(year: number, month: number): Cell[] {
  // Monday-start week: shift JS's Sunday-first getDay() (Sun=0) so Mon=0.
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrev = new Date(year, month, 0).getDate();
  const cells: Cell[] = [];
  for (let i = 0; i < 42; i++) {
    const offset = i - firstDow + 1;
    if (offset < 1) {
      const d = new Date(year, month - 1, daysInPrev + offset);
      cells.push({ year: d.getFullYear(), month: d.getMonth(), day: d.getDate(), inMonth: false });
    } else if (offset > daysInMonth) {
      const d = new Date(year, month + 1, offset - daysInMonth);
      cells.push({ year: d.getFullYear(), month: d.getMonth(), day: d.getDate(), inMonth: false });
    } else {
      cells.push({ year, month, day: offset, inMonth: true });
    }
  }
  return cells;
}

const selectClass =
  "rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100 focus:border-zinc-500 focus:outline-none";

// Left gutter (px) reserved for hour labels; the week-scan header/schedule/log
// bands all offset by it so their day columns line up.
const SCAN_GUTTER = 30;

// Circle style for a day number: red = menstruating, green = today (both = red
// with a green ring), dimmed outside the current month. `small` for the
// compressed rows of collapsed weeks.
function dayNumClass(opts: { isPeriod: boolean; isToday: boolean; inMonth: boolean; small: boolean }) {
  const size = opts.small ? "h-4 w-4 text-[10px]" : "h-6 w-6 text-xs";
  const color =
    opts.isPeriod && opts.isToday
      ? "bg-red-600 font-semibold text-white ring-2 ring-emerald-400"
      : opts.isPeriod
        ? "bg-red-600 font-semibold text-white"
        : opts.isToday
          ? "bg-emerald-600 font-semibold text-white"
          : opts.inMonth
            ? "text-zinc-300"
            : "text-zinc-600";
  return `inline-flex shrink-0 items-center justify-center rounded-full ${size} ${color}`;
}

export function CalendarPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  // Week row focused via its side tabs; that row grows, the others compress.
  const [expandedWeek, setExpandedWeek] = useState<number | null>(null);
  // Within the expanded week only: a clicked day widens, its siblings squeeze.
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  // How the current day was opened, so collapsing knows how far to go back:
  // "week" → the week was already open, collapse just the day; "month" → the
  // day was opened straight from the month grid, collapse the week too.
  const [dayExpandedFrom, setDayExpandedFrom] = useState<"week" | "month" | null>(null);

  function openDay(wi: number, key: string, weekAlreadyOpen: boolean) {
    if (weekAlreadyOpen) {
      setExpandedDay(key);
      setDayExpandedFrom("week");
    } else {
      setExpandedWeek(wi);
      setExpandedDay(key);
      setDayExpandedFrom("month");
    }
  }

  // Collapse the open day; also collapse its week if the day came from the
  // month grid. Called on any click inside an expanded day that isn't on a
  // control (input/button/etc.).
  function collapseExpandedDay() {
    if (dayExpandedFrom === "month") setExpandedWeek(null);
    setExpandedDay(null);
    setDayExpandedFrom(null);
  }

  // Fully reset expansion (used when the visible month changes).
  function collapseAll() {
    setExpandedWeek(null);
    setExpandedDay(null);
    setDayExpandedFrom(null);
  }

  // Side tab: toggle a whole week open/closed, dropping any focused day.
  function toggleWeek(wi: number, isOpen: boolean) {
    setExpandedWeek(isOpen ? null : wi);
    setExpandedDay(null);
    setDayExpandedFrom(null);
  }

  const { byDay, eventsByDay, exercises } = useDayData();
  const weather = useQuery({ queryKey: ["weather"], queryFn: getWeather });
  const { periodDays } = usePeriodDays();

  // Right-click context menu for toggling a day as menstruating.
  const [menu, setMenu] = useState<{ x: number; y: number; date: string } | null>(null);
  const queryClient = useQueryClient();
  const toggle = useMutation({
    mutationFn: togglePeriodDay,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["periods"] });
      setMenu(null);
    },
  });

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  function openContextMenu(e: React.MouseEvent, date: string) {
    e.preventDefault();
    const width = 190;
    const height = 90;
    setMenu({
      x: Math.min(e.clientX, window.innerWidth - width - 8),
      y: Math.min(e.clientY, window.innerHeight - height - 8),
      date,
    });
  }

  // The 42 cells chunked into 6 week rows so each row can expand/compress.
  const weeks = useMemo(() => {
    const cells = buildGrid(year, month);
    return Array.from({ length: 6 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
  }, [year, month]);
  const todayKey = dateKey(now.getFullYear(), now.getMonth(), now.getDate());

  // Forecast high + code by day (today-forward, ~7 days), and the grid row that
  // contains today — weather is shown only on that current-week row.
  const weatherByDay = useMemo(() => {
    const map = new Map<string, { code: number; tempMax: number }>();
    for (const d of weather.data?.daily ?? []) map.set(d.date, { code: d.code, tempMax: d.tempMax });
    return map;
  }, [weather.data]);
  const currentWeekIndex = useMemo(
    () => weeks.findIndex((week) => week.some((c) => dateKey(c.year, c.month, c.day) === todayKey)),
    [weeks, todayKey],
  );

  // A window of years around now; widens automatically if data falls outside it.
  const years = useMemo(() => {
    const ys = new Set<number>();
    for (let y = now.getFullYear() - 10; y <= now.getFullYear() + 2; y++) ys.add(y);
    for (const key of byDay.keys()) ys.add(Number(key.slice(0, 4)));
    return [...ys].sort();
  }, [byDay, now]);

  function shiftMonth(delta: number) {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
    collapseAll();
  }

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => shiftMonth(-1)}
          className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-700"
        >
          ←
        </button>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => shiftMonth(1)}
          className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-700"
        >
          →
        </button>
        <select
          aria-label="Month"
          value={month}
          onChange={(e) => {
            setMonth(Number(e.target.value));
            collapseAll();
          }}
          className={selectClass}
        >
          {MONTHS.map((name, i) => (
            <option key={name} value={i}>
              {name}
            </option>
          ))}
        </select>
        <select
          aria-label="Year"
          value={year}
          onChange={(e) => {
            setYear(Number(e.target.value));
            collapseAll();
          }}
          className={selectClass}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => {
            setYear(now.getFullYear());
            setMonth(now.getMonth());
            collapseAll();
          }}
          className="ml-auto rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-700"
        >
          Today
        </button>
      </div>

      {exercises.isError && (
        <p className="mt-4 text-sm text-red-400">
          Couldn't load exercises — {(exercises.error as Error).message}
        </p>
      )}

      {/* px-6 leaves a 1.5rem gutter each side for the week tabs to extend into. */}
      <div className="mt-4 px-6">
        <div className="rounded-xl border border-zinc-800">
          <div className="grid grid-cols-7 rounded-t-xl border-b border-zinc-800 bg-zinc-900">
            {WEEKDAYS.map((d) => (
              <div
                key={d}
                className="px-2 py-2 text-center text-xs font-medium uppercase tracking-wide text-zinc-500"
              >
                {d}
              </div>
            ))}
          </div>
          {/* Fixed-height stack: expanding a row redistributes space via
              flex-grow (1 -> 25), so the calendar's overall height never
              changes: expanded = 37.5rem, compressed rows = 1.5rem (one LH). */}
          <div className="flex h-[45rem] flex-col">
          {weeks.map((week, wi) => {
            const isExpanded = expandedWeek === wi;
            const isCompressed = expandedWeek !== null && !isExpanded;
            const tabClass = `absolute top-1 bottom-1 w-6 border border-zinc-700 text-xs transition-opacity hover:bg-zinc-700 hover:text-zinc-100 ${
              isExpanded
                ? "opacity-100 bg-zinc-700/80 text-zinc-200"
                : "opacity-0 bg-zinc-800 text-zinc-400 group-hover:opacity-100"
            }`;
            return (
              <div
                key={wi}
                className={`group relative flex min-h-0 basis-0 transition-[flex-grow] duration-300 ${
                  isExpanded ? "grow-[25]" : "grow"
                }`}
              >
                {/* flex (not grid) so an expanded day can widen via flex-grow.
                    The blue outline marks the selection: on the week when no
                    day is picked, else on the picked day cell below. */}
                <div
                  className={`flex min-w-0 flex-1 ${
                    wi < 5 ? "border-b border-zinc-800/60" : "overflow-hidden rounded-b-xl"
                  } ${
                    isExpanded && expandedDay === null
                      ? "outline outline-2 -outline-offset-2 outline-blue-500"
                      : ""
                  }`}
                >
                  {isExpanded && expandedDay === null ? (
                    // Unified week scan: one schedule scrollbar across all 7 days
                    // (top ~60%), with a per-day log row below (~40%).
                    <div className="flex min-h-0 w-full flex-col gap-1 px-0.5 py-1">
                      <div className="flex shrink-0">
                        <div style={{ width: SCAN_GUTTER }} className="shrink-0" />
                        {week.map((cell) => {
                          const key = dateKey(cell.year, cell.month, cell.day);
                          const wx = wi === currentWeekIndex ? weatherByDay.get(key) : undefined;
                          return (
                            <div
                              key={key}
                              onContextMenu={(e) => openContextMenu(e, key)}
                              className="flex min-w-0 flex-1 items-center justify-between gap-1 px-0.5"
                            >
                              <button
                                type="button"
                                aria-label={`Open ${key}`}
                                onClick={() => openDay(wi, key, true)}
                                className={`${dayNumClass({
                                  isPeriod: periodDays.has(key),
                                  isToday: key === todayKey,
                                  inMonth: cell.inMonth,
                                  small: false,
                                })} hover:opacity-80`}
                              >
                                {cell.day}
                              </button>
                              {wx && (
                                <span className="flex shrink-0 items-center gap-0.5 text-[10px] text-zinc-400">
                                  <span className="leading-none">{weatherEmoji(wx.code)}</span>
                                  <span className="tabular-nums">{wx.tempMax}°</span>
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      <div className="flex min-h-0 grow-[3] basis-0 flex-col">
                        <WeekSchedule
                          dates={week.map((c) => dateKey(c.year, c.month, c.day))}
                          gutter={SCAN_GUTTER}
                          onDateContextMenu={openContextMenu}
                        />
                      </div>
                      <div className="flex min-h-0 grow-[2] basis-0">
                        <div style={{ width: SCAN_GUTTER }} className="shrink-0" />
                        {week.map((cell) => {
                          const key = dateKey(cell.year, cell.month, cell.day);
                          return (
                            <div
                              key={key}
                              className="flex min-w-0 flex-1 flex-col border-l border-zinc-800/60 px-0.5"
                            >
                              <DayLog date={key} showLabel={false} />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    week.map((cell) => {
                    const key = dateKey(cell.year, cell.month, cell.day);
                    const entries = byDay.get(key) ?? [];
                    const dayEvents = eventsByDay.get(key) ?? [];
                    const isToday = key === todayKey;
                    const isDayExpanded = isExpanded && expandedDay === key;
                    // Siblings of an expanded day squeeze to a fixed width that
                    // fits just the day number (basis-9 = number + padding).
                    const isDaySqueezed = isExpanded && expandedDay !== null && !isDayExpanded;
                    const wx = wi === currentWeekIndex ? weatherByDay.get(key) : undefined;
                    const isPeriod = periodDays.has(key);
                    const dayNumberClass = dayNumClass({
                      isPeriod,
                      isToday,
                      inMonth: cell.inMonth,
                      small: isCompressed,
                    });
                    const weatherBadge = wx && !isCompressed && !isDaySqueezed && (
                      <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-zinc-400">
                        <span className="leading-none">{weatherEmoji(wx.code)}</span>
                        <span className="tabular-nums">{wx.tempMax}°</span>
                      </span>
                    );

                    // The expanded day hosts a form with real inputs (the log
                    // textarea), which can't safely live inside a <button> — so
                    // it renders as a div; only the day number toggles collapse.
                    if (isDayExpanded) {
                      // Calendar events already show in the Schedule pane below
                      // (DayForm), so only exercise chips are needed up here.
                      const hasChips = entries.length > 0;
                      return (
                        <div
                          key={key}
                          onContextMenu={(e) => openContextMenu(e, key)}
                          // Clicking anywhere in the expanded day collapses it,
                          // except on a control (typing in the log, hitting a
                          // button). Origin decides how far back collapsing goes.
                          onClick={(e) => {
                            if ((e.target as HTMLElement).closest("input, textarea, button, select, a"))
                              return;
                            collapseExpandedDay();
                          }}
                          aria-label={key}
                          // gap-3 (12px) between sections matches the p-3 frame
                          // for an even, consistent rhythm on every edge.
                          className={`flex min-h-0 grow basis-0 flex-col gap-3 overflow-hidden border-r border-zinc-800/60 p-3 text-left outline outline-2 -outline-offset-2 outline-blue-500 last:border-r-0 ${
                            cell.inMonth ? "bg-zinc-900" : "bg-zinc-950/60"
                          }`}
                        >
                          <div className="flex shrink-0 items-center justify-between gap-1">
                            <button
                              type="button"
                              aria-label={`Collapse ${key}`}
                              onClick={collapseExpandedDay}
                              className={`${dayNumberClass} hover:opacity-80`}
                            >
                              {cell.day}
                            </button>
                            {weatherBadge}
                          </div>
                          {hasChips && (
                            // [&>div]:mt-0 drops DayChips' built-in mt-1 so the
                            // section gap alone controls spacing here.
                            <div className="shrink-0 [&>div]:mt-0">
                              <DayChips dayEvents={[]} entries={entries} />
                            </div>
                          )}
                          <DayForm date={key} />
                        </div>
                      );
                    }

                    return (
                      <button
                        type="button"
                        key={key}
                        onClick={() => openDay(wi, key, isExpanded)}
                        onContextMenu={(e) => openContextMenu(e, key)}
                        aria-label={key}
                        className={`flex flex-col overflow-hidden border-r border-zinc-800/60 text-left transition-[flex-grow,flex-basis] duration-300 last:border-r-0 hover:bg-zinc-800/40 ${
                          isDaySqueezed ? "grow-0 basis-9" : "grow basis-0"
                        } ${isCompressed ? "p-0.5" : "p-1.5"} ${
                          cell.inMonth ? "bg-zinc-900" : "bg-zinc-950/60"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className={dayNumberClass}>{cell.day}</span>
                          {weatherBadge}
                        </div>
                        <DayChips dayEvents={dayEvents} entries={entries} />
                      </button>
                    );
                    })
                  )}
                </div>
                {/* Side tabs: appear on row hover, extend 1.5rem past each edge,
                    and toggle this week's expansion. */}
                <button
                  type="button"
                  aria-label={isExpanded ? `Collapse week ${wi + 1}` : `Expand week ${wi + 1}`}
                  aria-expanded={isExpanded}
                  onClick={() => toggleWeek(wi, isExpanded)}
                  className={`${tabClass} -left-6 rounded-l-lg border-r-0`}
                >
                  {isExpanded ? "−" : "+"}
                </button>
                <button
                  type="button"
                  aria-label={isExpanded ? `Collapse week ${wi + 1}` : `Expand week ${wi + 1}`}
                  aria-expanded={isExpanded}
                  onClick={() => toggleWeek(wi, isExpanded)}
                  className={`${tabClass} -right-6 rounded-r-lg border-l-0`}
                >
                  {isExpanded ? "−" : "+"}
                </button>
              </div>
            );
          })}
          </div>
        </div>
      </div>

      {menu && (
        <>
          {/* Click-away / right-click-away overlay to dismiss the menu. */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu(null);
            }}
          />
          <div
            className="fixed z-50 w-52 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-800 py-1 text-sm shadow-xl"
            style={{ top: menu.y, left: menu.x }}
          >
            <button
              type="button"
              disabled={toggle.isPending}
              onClick={() => toggle.mutate({ date: menu.date })}
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-zinc-200 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span
                className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
                  periodDays.has(menu.date) ? "bg-red-500" : "border border-zinc-500"
                }`}
              />
              menstruating
            </button>
          </div>
        </>
      )}
    </>
  );
}
