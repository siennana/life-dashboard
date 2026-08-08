import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getCalendarLastUpdated, getCashflow, getWeather, togglePeriodDay } from "../api";
import type { CashflowDay } from "@life/shared";
import { DayChips, dateKey, useDayData, WEEKDAYS } from "../lib/calendar";
import { quietBtnClass } from "../lib/controls";
import { weatherEmoji } from "../lib/weather";
import { usePeriodDays } from "../lib/period";
import { useIsMobile } from "../lib/useIsMobile";
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

const cellKey = (c: Cell) => dateKey(c.year, c.month, c.day);

// True when a click landed on an interactive control, so container-level
// "click empty space to collapse" handlers leave it alone.
const isControlClick = (e: React.MouseEvent) =>
  (e.target as HTMLElement).closest("input, textarea, button, select, a") !== null;

// Controls share Bank's quiet-button style (quietBtnClass). Month/year are
// native <select>s styled to match — the current value reads as the label,
// and field-sizing trims each to its selected option so the row stays evenly
// spaced (unsupported browsers just get slack after short month names).
const selectClass =
  "field-sizing-content appearance-none rounded-md bg-transparent px-2 py-1 text-sm font-medium text-zinc-100 hover:bg-zinc-800 focus:outline-none";
const arrowClass = quietBtnClass;
const todayClass = `${quietBtnClass} text-sm`;

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
  // Animate width/height/font-size so the circle eases between full and small
  // as its week row expands/compresses (matches the row's flex-grow easing).
  return `inline-flex shrink-0 items-center justify-center rounded-full transition-all duration-300 ${size} ${color}`;
}

// One unified border around the whole drag range: every selected cell draws
// the top/bottom edges and the two ends add their outer edge — inset shadows,
// so the cells' real borders and layout don't shift while dragging.
const DRAG_EDGE = "rgb(59 130 246 / 0.8)"; // blue-500
function dragSelShadow(isFirst: boolean, isLast: boolean) {
  const edges = [`inset 0 2px 0 0 ${DRAG_EDGE}`, `inset 0 -2px 0 0 ${DRAG_EDGE}`];
  if (isFirst) edges.push(`inset 2px 0 0 0 ${DRAG_EDGE}`);
  if (isLast) edges.push(`inset -2px 0 0 0 ${DRAG_EDGE}`);
  return edges.join(", ");
}

// Compact net-cashflow chip: "-$55" (money out, red) / "+$1,200" (money in,
// green), rounded to whole dollars to stay narrow in a cell. A covered day with
// no movement shows a grey "$0". `covered` is false outside the Plaid history
// window (before the first transaction, or in the future) — those render
// nothing rather than a misleading $0.
function CashflowBadge({ day, covered }: { day: CashflowDay | undefined; covered: boolean }) {
  if (!covered) return null;
  const net = day?.net ?? 0;
  const label = net === 0 ? "$0" : `${net < 0 ? "-" : "+"}$${Math.abs(Math.round(net)).toLocaleString()}`;
  const color = net < 0 ? "text-red-400" : net > 0 ? "text-emerald-400" : "text-zinc-500";
  const parts = [
    day && day.spend > 0 ? `Spent $${Math.round(day.spend).toLocaleString()}` : null,
    day && day.income > 0 ? `Income $${Math.round(day.income).toLocaleString()}` : null,
  ].filter(Boolean);
  const title = parts.length > 0 ? parts.join(" · ") : "No transactions";
  return (
    <span title={title} className={`shrink-0 text-[11px] tabular-nums ${color}`}>
      {label}
    </span>
  );
}

export function CalendarPage() {
  const now = new Date();
  const isMobile = useIsMobile();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  // The expanded week row; that row grows, the others compress.
  const [expandedWeek, setExpandedWeek] = useState<number | null>(null);
  // Contiguous drag-selected days within the expanded week. The scan view
  // shows exactly these days; the row's other cells squeeze aside.
  const [selection, setSelection] = useState<string[] | null>(null);
  // A single fully-open day (DayForm); may sit on top of a selection.
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  // How the day was opened, so collapsing knows how far back to go:
  // "selection" → return to the selected-days scan; "month" → all the way out.
  const [dayExpandedFrom, setDayExpandedFrom] = useState<"selection" | "month" | null>(null);
  // Live drag range (cell highlighting only; day indices within one week).
  const [dragSel, setDragSel] = useState<{ week: number; a: number; b: number } | null>(null);
  const dragRef = useRef<object | null>(null);
  // Desktop grid container, for collapsing the expansion on outside clicks.
  const gridRef = useRef<HTMLDivElement | null>(null);
  // Set while the click that trails a finished drag fires, so it doesn't also
  // open a day on top of the selection the drag just made.
  const suppressClickRef = useRef(false);

  function openDaySingle(wi: number, key: string) {
    setExpandedWeek(wi);
    setSelection(null);
    setExpandedDay(key);
    setDayExpandedFrom("month");
  }

  function openDayInSelection(wi: number, key: string) {
    setExpandedWeek(wi);
    setExpandedDay(key);
    setDayExpandedFrom("selection");
  }

  // Collapse the open day: back to its selection scan if it came from one,
  // else all the way back to the month grid. Called on any click inside an
  // expanded day that isn't on a control (input/button/etc.).
  function collapseExpandedDay() {
    if (dayExpandedFrom !== "selection") {
      setExpandedWeek(null);
      setSelection(null);
    }
    setExpandedDay(null);
    setDayExpandedFrom(null);
  }

  // Fully reset expansion (used when the visible month changes).
  function collapseAll() {
    setExpandedWeek(null);
    setSelection(null);
    setExpandedDay(null);
    setDayExpandedFrom(null);
  }

  const { byDay, eventsByDay, exercises } = useDayData();
  const weather = useQuery({ queryKey: ["weather"], queryFn: getWeather });
  const cashflow = useQuery({ queryKey: ["cashflow"], queryFn: getCashflow });
  const lastUpdated = useQuery({
    queryKey: ["calendar-last-updated"],
    queryFn: getCalendarLastUpdated,
  });
  const { periodDays } = usePeriodDays();
  const lastSavedText = lastUpdated.data?.updatedAt
    ? new Date(lastUpdated.data.updatedAt).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

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

  // Desktop: clicking anywhere outside the calendar grid collapses whatever
  // is expanded (mobile navigates with breadcrumbs instead). Skipped while
  // the period context menu is open — its overlay click just closes the menu.
  useEffect(() => {
    if (isMobile || expandedWeek === null) return;
    const onDown = (e: PointerEvent) => {
      if (menu) return;
      if (gridRef.current?.contains(e.target as Node)) return;
      collapseAll();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [isMobile, expandedWeek, menu]);

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

  function openSelection(wi: number, a: number, b: number) {
    const keys = weeks[wi].slice(a, b + 1).map(cellKey);
    setExpandedWeek(wi);
    setSelection(keys);
    setExpandedDay(null);
    setDayExpandedFrom(null);
  }

  // A plain click/tap on a day cell (also the landing spot for a single-cell
  // drag). From a selection scan it opens the day on top of the selection;
  // otherwise it opens the day directly from the month grid.
  function cellClick(wi: number, key: string) {
    if (expandedWeek === wi && expandedDay === null && selection) openDayInSelection(wi, key);
    else if (expandedWeek === wi && expandedDay !== null) setExpandedDay(key);
    else openDaySingle(wi, key);
  }
  function handleCellClick(wi: number, key: string) {
    if (!suppressClickRef.current) cellClick(wi, key);
  }

  // Press-drag day selection across a week. Mouse: press and drag. Touch:
  // long-press (350ms) engages selection first — moving before it fires is a
  // scroll and cancels. Listeners attach per-gesture on window; the hovered
  // cell comes from elementFromPoint (not enter events) because touch pointer
  // events stay captured on the cell where the gesture started.
  function beginDrag(e: React.PointerEvent, wi: number, di: number) {
    if (dragRef.current) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const isTouch = e.pointerType !== "mouse";
    const drag = {
      startIdx: di,
      endIdx: di,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
      timer: 0,
    };
    dragRef.current = drag;

    const setRange = () =>
      setDragSel({
        week: wi,
        a: Math.min(drag.startIdx, drag.endIdx),
        b: Math.max(drag.startIdx, drag.endIdx),
      });
    const activate = () => {
      drag.active = true;
      document.body.style.userSelect = "none";
      setRange();
    };
    if (isTouch) drag.timer = window.setTimeout(activate, 350);

    const onMove = (ev: PointerEvent) => {
      if (!drag.active) {
        const dist = Math.hypot(ev.clientX - drag.startX, ev.clientY - drag.startY);
        if (isTouch) {
          // Finger moved before the long-press fired — treat as a scroll.
          if (dist > 10) cleanup();
          return;
        }
        if (dist <= 6) return;
        activate();
      }
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const cell = el?.closest<HTMLElement>("[data-di]");
      if (!cell || Number(cell.dataset.wi) !== wi) return;
      const cdi = Number(cell.dataset.di);
      if (cdi === drag.endIdx) return;
      drag.endIdx = cdi;
      setRange();
    };
    const onUp = () => {
      const { active, startIdx, endIdx } = drag;
      cleanup();
      if (!active) return; // plain click/tap — the cell's onClick handles it
      suppressClickRef.current = true;
      setTimeout(() => (suppressClickRef.current = false), 0);
      const a = Math.min(startIdx, endIdx);
      const b = Math.max(startIdx, endIdx);
      if (a === b) {
        cellClick(wi, cellKey(weeks[wi][a]));
      } else {
        openSelection(wi, a, b);
      }
    };
    // Scroll can only be blocked from a real non-passive touch listener, and
    // only once selection mode is engaged.
    const onTouchMove = (ev: TouchEvent) => {
      if (drag.active) ev.preventDefault();
    };
    function cleanup() {
      window.clearTimeout(drag.timer);
      document.body.style.userSelect = "";
      dragRef.current = null;
      setDragSel(null);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", cleanup);
      document.removeEventListener("touchmove", onTouchMove);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", cleanup);
    document.addEventListener("touchmove", onTouchMove, { passive: false });
  }

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

  // Net cashflow per day (income − spend). Shown on any day with movement,
  // regardless of month — unlike weather, which is a current-week forecast.
  const cashflowByDay = useMemo(() => {
    const map = new Map<string, CashflowDay>();
    for (const d of cashflow.data?.days ?? []) map.set(d.date, d);
    return map;
  }, [cashflow.data]);
  // A day is "covered" (eligible for a $0) only from the first transaction
  // through today — days are returned oldest-first, so [0] is the earliest.
  const firstCashDate = cashflow.data?.days[0]?.date ?? null;
  const isCashCovered = (key: string) =>
    firstCashDate != null && key >= firstCashDate && key <= todayKey;

  // Day-number circle class with the per-day flags derived in one place.
  const dayNum = (key: string, inMonth: boolean, small: boolean) =>
    dayNumClass({ isPeriod: periodDays.has(key), isToday: key === todayKey, inMonth, small });

  // The weather + cashflow badge pair every day header shows. Weather is a
  // current-week-only forecast, so it needs the day's row index; `dense` is
  // the compact 10px form for tight columns.
  const dayBadges = (key: string, wi: number | null, dense = false) => {
    const wx = wi === currentWeekIndex ? weatherByDay.get(key) : undefined;
    return (
      <>
        {wx && (
          <span
            className={`flex shrink-0 items-center text-zinc-400 ${
              dense ? "gap-0.5 text-[10px]" : "gap-1.5 text-[11px]"
            }`}
          >
            <span className="leading-none">{weatherEmoji(wx.code)}</span>
            <span className="tabular-nums">{wx.tempMax}°</span>
          </span>
        )}
        <CashflowBadge day={cashflowByDay.get(key)} covered={isCashCovered(key)} />
      </>
    );
  };

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

  // Mobile (below md): no flex-grow compression — month, week, and day are
  // three views that each fill the whole component, with a breadcrumb row
  // above the grid to navigate back up. A render function (not a nested
  // component) so the day form's inputs keep identity across re-renders.
  function renderMobile() {
    const week = expandedWeek !== null ? weeks[expandedWeek] : null;
    // Tap = day view directly; drag-selection = week view over those days.
    // Day view opened from a selection keeps the selection crumb beneath it.
    const view = expandedDay !== null ? "day" : week && selection ? "week" : "month";
    const fmtCell = (c: Cell) =>
      new Date(c.year, c.month, c.day).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
    const selCells =
      week && selection ? week.filter((c) => selection.includes(cellKey(c))) : null;
    const weekLabel =
      selCells && selCells.length > 0
        ? selCells.length === 1
          ? fmtCell(selCells[0])
          : `${fmtCell(selCells[0])} – ${fmtCell(selCells[selCells.length - 1])}`
        : "";
    let dayLabel = "";
    if (expandedDay) {
      const [y, m, d] = expandedDay.split("-").map(Number);
      dayLabel = new Date(y, m - 1, d).toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
    }
    const crumbClass = "text-zinc-400 active:text-zinc-200";

    // The expanded day's cell (for the dimmed out-of-month treatment); the day
    // always belongs to the expanded week, so this only misses if state drifts.
    const expandedCell = week?.find((c) => cellKey(c) === expandedDay);

    return (
      <>
        {view !== "month" && (
          <nav aria-label="Calendar breadcrumb" className="mt-4 flex items-center gap-2 text-sm">
            <button type="button" onClick={collapseAll} className={crumbClass}>
              {MONTHS[month]}
            </button>
            <span className="text-zinc-600">/</span>
            {view === "day" ? (
              <>
                {selection && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setExpandedDay(null);
                        setDayExpandedFrom(null);
                      }}
                      className={crumbClass}
                    >
                      {weekLabel}
                    </button>
                    <span className="text-zinc-600">/</span>
                  </>
                )}
                <span className="font-medium text-zinc-100">{dayLabel}</span>
              </>
            ) : (
              <span className="font-medium text-zinc-100">{weekLabel}</span>
            )}
          </nav>
        )}

        {/* Full-bleed: -mx-4 escapes the page's px-4 so the grid spans edge to
            edge (Apple Calendar style); border-y only, no rounded frame. */}
        <div className="-mx-4 mt-3 border-y border-zinc-800">
          {view === "month" && (
            <>
              <div className="grid grid-cols-7 border-b border-zinc-800 bg-zinc-900">
                {WEEKDAYS.map((d) => (
                  <div
                    key={d}
                    className="py-1.5 text-center text-[10px] font-medium uppercase tracking-wide text-zinc-500"
                  >
                    {d}
                  </div>
                ))}
              </div>
              {weeks.map((weekRow, wi) => (
                <div
                  key={wi}
                  className={`grid grid-cols-7 ${wi < 5 ? "border-b border-zinc-800/60" : ""}`}
                >
                  {weekRow.map((cell, di) => {
                    const key = cellKey(cell);
                    const dayEvents = eventsByDay.get(key) ?? [];
                    const entries = byDay.get(key) ?? [];
                    const inDragSel =
                      dragSel !== null && dragSel.week === wi && di >= dragSel.a && di <= dragSel.b;
                    return (
                      <button
                        type="button"
                        key={key}
                        data-wi={wi}
                        data-di={di}
                        onPointerDown={(e) => beginDrag(e, wi, di)}
                        onClick={() => handleCellClick(wi, key)}
                        aria-label={`Open ${key}`}
                        style={
                          dragSel && inDragSel
                            ? { boxShadow: dragSelShadow(di === dragSel.a, di === dragSel.b) }
                            : undefined
                        }
                        className={`flex h-[4.75rem] min-w-0 select-none flex-col items-center gap-0.5 overflow-hidden border-r border-zinc-800/60 px-0.5 py-1 [-webkit-touch-callout:none] last:border-r-0 ${
                          cell.inMonth ? "bg-zinc-900" : "bg-zinc-950/60"
                        }`}
                      >
                        <span className={dayNum(key, cell.inMonth, false)}>{cell.day}</span>
                        {dayBadges(key, wi, true)}
                        {(dayEvents.length > 0 || entries.length > 0) && (
                          // Apple-style dots instead of text chips: violet =
                          // events, blue = exercises (capped, no counts).
                          <span className="flex shrink-0 items-center gap-0.5">
                            {dayEvents.slice(0, 3).map((_, i) => (
                              <span key={`e${i}`} className="h-1 w-1 rounded-full bg-violet-400" />
                            ))}
                            {entries.slice(0, 2).map((_, i) => (
                              <span key={`x${i}`} className="h-1 w-1 rounded-full bg-blue-400" />
                            ))}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </>
          )}

          {view === "week" && week && selection && (
            <div className="flex h-[calc(100dvh-14rem)] min-h-96 flex-col">
              <div className="flex shrink-0 border-b border-zinc-800/60 bg-zinc-900 py-1">
                <div style={{ width: SCAN_GUTTER }} className="shrink-0" />
                {week.map((cell, i) => {
                  const key = cellKey(cell);
                  if (!selection.includes(key)) return null;
                  return (
                    <button
                      type="button"
                      key={key}
                      onClick={() => {
                        setExpandedDay(key);
                        setDayExpandedFrom("selection");
                      }}
                      aria-label={`Open ${key}`}
                      className="flex min-w-0 flex-1 flex-col items-center gap-0.5 overflow-hidden px-0.5 py-0.5"
                    >
                      <span className="text-[10px] uppercase tracking-wide text-zinc-500">
                        {WEEKDAYS[i]}
                      </span>
                      <span className={dayNum(key, cell.inMonth, false)}>{cell.day}</span>
                      {dayBadges(key, expandedWeek, true)}
                    </button>
                  );
                })}
              </div>
              <WeekSchedule dates={selection} gutter={SCAN_GUTTER} />
            </div>
          )}

          {view === "day" && expandedDay && (
            <div className="flex flex-col gap-2 p-3">
              <div className="flex items-center justify-between gap-1">
                <span className={dayNum(expandedDay, expandedCell?.inMonth ?? true, false)}>
                  {Number(expandedDay.slice(8))}
                </span>
                <span className="flex min-w-0 items-center gap-1.5">
                  {dayBadges(expandedDay, expandedWeek, true)}
                </span>
              </div>
              <DayForm date={expandedDay} />
            </div>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      {/* "Last saved" pinned top-right; beneath it a single control row — the
          ← August 2026 → switcher left, Today right — so all buttons align. */}
      {lastSavedText && (
        <div className="mt-1 text-right text-xs text-zinc-500 md:mt-6">
          Last saved {lastSavedText}
        </div>
      )}
      <div className={`${lastSavedText ? "mt-0.5" : "mt-1 md:mt-6"} flex items-center gap-1`}>
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => shiftMonth(-1)}
          className={arrowClass}
        >
          ←
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
          aria-label="Next month"
          onClick={() => shiftMonth(1)}
          className={arrowClass}
        >
          →
        </button>
        <button
          type="button"
          onClick={() => {
            setYear(now.getFullYear());
            setMonth(now.getMonth());
            collapseAll();
          }}
          className={`ml-auto ${todayClass}`}
        >
          Today
        </button>
      </div>

      {exercises.isError && (
        <p className="mt-4 text-sm text-red-400">
          Couldn't load exercises — {(exercises.error as Error).message}
        </p>
      )}

      {isMobile ? (
        renderMobile()
      ) : (
      <div ref={gridRef} className="mt-4">
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
              changes: expanded = 45rem, compressed rows = 1.8rem (one LH). */}
          <div className="flex h-[54rem] flex-col">
          {weeks.map((week, wi) => {
            const isExpanded = expandedWeek === wi;
            const isCompressed = expandedWeek !== null && !isExpanded;
            return (
              <div
                key={wi}
                className={`relative flex min-h-0 basis-0 transition-[flex-grow] duration-300 ${
                  isExpanded ? "grow-[25]" : "grow"
                }`}
              >
                {/* flex (not grid) so an expanded day can widen via flex-grow.
                    The blue outline marks the selection: on the scan block, or
                    on the picked day cell below. */}
                <div
                  className={`flex min-w-0 flex-1 ${
                    wi < 5 ? "border-b border-zinc-800/60" : "overflow-hidden rounded-b-xl"
                  }`}
                >
                  {isExpanded && expandedDay === null && selection ? (
                    // Selected-days scan: the drag-selected days share one
                    // schedule scrollbar (top ~60%) with a per-day log row
                    // below (~40%); unselected cells squeeze to slim strips.
                    // Clicking non-control space in the scan collapses it.
                    week.map((cell) => {
                      const key = cellKey(cell);
                      const selIdx = selection.indexOf(key);
                      if (selIdx > 0) return null; // covered by the scan block
                      if (selIdx === -1) {
                        return (
                          <button
                            type="button"
                            key={key}
                            onClick={() => handleCellClick(wi, key)}
                            onContextMenu={(e) => openContextMenu(e, key)}
                            aria-label={key}
                            className={`flex grow-0 basis-6 flex-col overflow-hidden border-r border-zinc-800/60 p-0.5 text-left last:border-r-0 hover:bg-zinc-800/40 ${
                              cell.inMonth ? "bg-zinc-900" : "bg-zinc-950/60"
                            }`}
                          >
                            <span className={dayNum(key, cell.inMonth, true)}>{cell.day}</span>
                          </button>
                        );
                      }
                      const selCells = week.filter((c) => selection.includes(cellKey(c)));
                      return (
                        <div
                          key={key}
                          onClick={(e) => {
                            if (isControlClick(e)) return;
                            collapseAll();
                          }}
                          className="flex min-h-0 min-w-0 flex-1 flex-col gap-1 px-0.5 py-1 outline outline-2 -outline-offset-2 outline-blue-500"
                        >
                          <div className="flex shrink-0">
                            <div style={{ width: SCAN_GUTTER }} className="shrink-0" />
                            {selCells.map((c) => {
                              const k = cellKey(c);
                              return (
                                <div
                                  key={k}
                                  onContextMenu={(e) => openContextMenu(e, k)}
                                  className="flex min-w-0 flex-1 items-center justify-between gap-1 px-0.5"
                                >
                                  <button
                                    type="button"
                                    aria-label={`Open ${k}`}
                                    onClick={() => openDayInSelection(wi, k)}
                                    className={`${dayNum(k, c.inMonth, false)} hover:opacity-80`}
                                  >
                                    {c.day}
                                  </button>
                                  <span className="flex min-w-0 items-center gap-1">
                                    {dayBadges(k, wi, true)}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                          <div className="flex min-h-0 grow-[3] basis-0 flex-col">
                            <WeekSchedule
                              dates={selection}
                              gutter={SCAN_GUTTER}
                              onDateContextMenu={openContextMenu}
                            />
                          </div>
                          <div className="flex min-h-0 grow-[2] basis-0">
                            <div style={{ width: SCAN_GUTTER }} className="shrink-0" />
                            {selCells.map((c) => {
                              const k = cellKey(c);
                              return (
                                <div
                                  key={k}
                                  className="flex min-w-0 flex-1 flex-col border-l border-zinc-800/60 px-0.5"
                                >
                                  <DayLog date={k} showLabel={false} />
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    week.map((cell, di) => {
                    const key = cellKey(cell);
                    const inDragSel =
                      dragSel !== null && dragSel.week === wi && di >= dragSel.a && di <= dragSel.b;
                    const entries = byDay.get(key) ?? [];
                    const dayEvents = eventsByDay.get(key) ?? [];
                    const isDayExpanded = isExpanded && expandedDay === key;
                    // Siblings of an expanded day squeeze to a fixed width that
                    // fits just the (small) day number (basis-6 = number +
                    // padding), so the expanded day gets as much width as
                    // possible. Squeezed siblings use the same small number as
                    // the compressed week rows.
                    const isDaySqueezed = isExpanded && expandedDay !== null && !isDayExpanded;
                    const dayNumberClass = dayNum(key, cell.inMonth, isCompressed || isDaySqueezed);
                    // Weather (current-week forecast) then cashflow, right-aligned.
                    const rightBadges = !isCompressed && !isDaySqueezed && (
                      <span className="flex min-w-0 items-center gap-1.5">{dayBadges(key, wi)}</span>
                    );

                    // The expanded day hosts a form with real inputs (the log
                    // textarea), which can't safely live inside a <button> — so
                    // it renders as a div; only the day number toggles collapse.
                    if (isDayExpanded) {
                      // Events + exercises both show in the Schedule pane below
                      // (DayForm), so no chips are needed in the expanded header.
                      return (
                        <div
                          key={key}
                          onContextMenu={(e) => openContextMenu(e, key)}
                          // Clicking anywhere in the expanded day collapses it,
                          // except on a control (typing in the log, hitting a
                          // button). Origin decides how far back collapsing goes.
                          onClick={(e) => {
                            if (isControlClick(e)) return;
                            collapseExpandedDay();
                          }}
                          aria-label={key}
                          // gap-2 (8px) between sections matches the p-2 frame
                          // for an even, consistent rhythm on every edge.
                          className={`flex min-h-0 grow basis-0 flex-col gap-2 overflow-hidden border-r border-zinc-800/60 p-2 text-left outline outline-2 -outline-offset-2 outline-blue-500 last:border-r-0 ${
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
                            {rightBadges}
                          </div>
                          <DayForm date={key} />
                        </div>
                      );
                    }

                    return (
                      <button
                        type="button"
                        key={key}
                        data-wi={wi}
                        data-di={di}
                        onPointerDown={(e) => beginDrag(e, wi, di)}
                        onClick={() => handleCellClick(wi, key)}
                        onContextMenu={(e) => openContextMenu(e, key)}
                        aria-label={key}
                        style={
                          dragSel && inDragSel
                            ? { boxShadow: dragSelShadow(di === dragSel.a, di === dragSel.b) }
                            : undefined
                        }
                        className={`flex select-none flex-col overflow-hidden border-r border-zinc-800/60 text-left transition-[flex-grow,flex-basis,padding] duration-300 [-webkit-touch-callout:none] last:border-r-0 hover:bg-zinc-800/40 ${
                          isDaySqueezed ? "grow-0 basis-6" : "grow basis-0"
                        } ${isCompressed || isDaySqueezed ? "p-0.5" : "p-1.5"} ${
                          cell.inMonth ? "bg-zinc-900" : "bg-zinc-950/60"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className={dayNumberClass}>{cell.day}</span>
                          {rightBadges}
                        </div>
                        <DayChips dayEvents={dayEvents} entries={entries} />
                      </button>
                    );
                    })
                  )}
                </div>
              </div>
            );
          })}
          </div>
        </div>
      </div>
      )}

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
