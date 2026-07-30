import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getWeather } from "../api";
import { DayChips, dateKey, useDayData, WEEKDAYS } from "../lib/calendar";
import { weatherEmoji } from "../lib/weather";

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

export function CalendarPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  // Week row focused via its side tabs; that row grows, the others compress.
  const [expandedWeek, setExpandedWeek] = useState<number | null>(null);
  // Within the expanded week only: a clicked day widens, its siblings squeeze.
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  const { byDay, eventsByDay, exercises } = useDayData();
  const weather = useQuery({ queryKey: ["weather"], queryFn: getWeather });

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
    setExpandedWeek(null);
    setExpandedDay(null);
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
            setExpandedWeek(null);
            setExpandedDay(null);
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
            setExpandedWeek(null);
            setExpandedDay(null);
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
            setExpandedWeek(null);
            setExpandedDay(null);
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
                  {week.map((cell) => {
                    const key = dateKey(cell.year, cell.month, cell.day);
                    const entries = byDay.get(key) ?? [];
                    const dayEvents = eventsByDay.get(key) ?? [];
                    const isToday = key === todayKey;
                    const isDayExpanded = isExpanded && expandedDay === key;
                    // Siblings of an expanded day squeeze to a fixed width that
                    // fits just the day number (basis-9 = number + padding).
                    const isDaySqueezed = isExpanded && expandedDay !== null && !isDayExpanded;
                    const wx = wi === currentWeekIndex ? weatherByDay.get(key) : undefined;
                    return (
                      <button
                        type="button"
                        key={key}
                        onClick={() => {
                          if (isExpanded) {
                            // Inside the expanded week, clicking toggles the day.
                            setExpandedDay((d) => (d === key ? null : key));
                          } else {
                            // From anywhere else, jump straight to the day:
                            // expand its week and the day in one click.
                            setExpandedWeek(wi);
                            setExpandedDay(key);
                          }
                        }}
                        aria-label={key}
                        className={`flex flex-col overflow-hidden border-r border-zinc-800/60 text-left transition-[flex-grow,flex-basis] duration-300 last:border-r-0 hover:bg-zinc-800/40 ${
                          isDaySqueezed ? "grow-0 basis-9" : "grow basis-0"
                        } ${isCompressed ? "p-0.5" : "p-1.5"} ${
                          cell.inMonth ? "bg-zinc-900" : "bg-zinc-950/60"
                        } ${
                          isDayExpanded
                            ? "outline outline-2 -outline-offset-2 outline-blue-500"
                            : ""
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span
                            className={`inline-flex shrink-0 items-center justify-center rounded-full ${
                              isCompressed ? "h-4 w-4 text-[10px]" : "h-6 w-6 text-xs"
                            } ${
                              isToday
                                ? "bg-emerald-600 font-semibold text-white"
                                : cell.inMonth
                                  ? "text-zinc-300"
                                  : "text-zinc-600"
                            }`}
                          >
                            {cell.day}
                          </span>
                          {wx && !isCompressed && !isDaySqueezed && (
                            <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-zinc-400">
                              <span className="leading-none">{weatherEmoji(wx.code)}</span>
                              <span className="tabular-nums">{wx.tempMax}°</span>
                            </span>
                          )}
                        </div>
                        <DayChips dayEvents={dayEvents} entries={entries} />
                      </button>
                    );
                  })}
                </div>
                {/* Side tabs: appear on row hover, extend 1.5rem past each edge,
                    and toggle this week's expansion. */}
                <button
                  type="button"
                  aria-label={isExpanded ? `Collapse week ${wi + 1}` : `Expand week ${wi + 1}`}
                  aria-expanded={isExpanded}
                  onClick={() => {
                    setExpandedWeek(isExpanded ? null : wi);
                    setExpandedDay(null);
                  }}
                  className={`${tabClass} -left-6 rounded-l-lg border-r-0`}
                >
                  {isExpanded ? "−" : "+"}
                </button>
                <button
                  type="button"
                  aria-label={isExpanded ? `Collapse week ${wi + 1}` : `Expand week ${wi + 1}`}
                  aria-expanded={isExpanded}
                  onClick={() => {
                    setExpandedWeek(isExpanded ? null : wi);
                    setExpandedDay(null);
                  }}
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
    </>
  );
}
