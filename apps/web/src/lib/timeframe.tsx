import { useCallback, useMemo, useState, type ReactNode } from "react";
import { quietBtnClass } from "./controls";

// Week / month / year stat windows with calendar-style ←/→ stepping, shared by
// the Exercise and Reading stat panels so the switcher behaves identically.

export type Period = "week" | "month" | "year" | "all";
const PERIODS: Period[] = ["week", "month", "year", "all"];

export const ymd = (x: Date) =>
  `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;

// Local calendar date as YYYY-MM-DD (so "today" matches the user's clock, not UTC).
export function localToday(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

// Monday-start week (matching the calendar) containing `dateStr`, as inclusive
// YYYY-MM-DD bounds. Callers string-compare row dates, so no TZ math beyond this.
export function weekBounds(dateStr: string): { start: string; end: string } {
  const d = new Date(`${dateStr}T12:00:00`);
  const mondayOffset = (d.getDay() + 6) % 7; // shift JS Sun=0 so Mon=0
  const monday = new Date(d);
  monday.setDate(d.getDate() - mondayOffset);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: ymd(monday), end: ymd(sunday) };
}

const shortDate = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export type PeriodBucket = { key: string; label: string; name: string; start: string; end: string };

// Sub-windows one level below the viewed period, as inclusive YYYY-MM-DD
// bounds: all → years (data's first year through the anchor year), year →
// months, month → Monday-start weeks clipped to the month (so an entry near a
// month edge counts only in its own month). Week has no finer bucket → null.
// `allDates` is only consulted for the "all" span.
export function periodBuckets(
  period: Period,
  anchor: string,
  allDates: string[],
): { title: string; buckets: PeriodBucket[] } | null {
  if (period === "all") {
    if (allDates.length === 0) return { title: "Per year", buckets: [] };
    const years = allDates.map((d) => Number(d.slice(0, 4)));
    const last = Math.max(...years, Number(anchor.slice(0, 4)));
    const buckets: PeriodBucket[] = [];
    for (let y = Math.min(...years); y <= last; y++) {
      const yr = String(y);
      buckets.push({ key: yr, label: yr, name: yr, start: `${yr}-01-01`, end: `${yr}-12-31` });
    }
    return { title: "Per year", buckets };
  }
  if (period === "year") {
    const yr = anchor.slice(0, 4);
    const buckets = Array.from({ length: 12 }, (_, i): PeriodBucket => {
      const mm = String(i + 1).padStart(2, "0");
      const name = new Date(`${yr}-${mm}-15T12:00:00`).toLocaleDateString(undefined, {
        month: "short",
      });
      return {
        key: mm,
        label: "JFMAMJJASOND"[i]!,
        name: `${name} ${yr}`,
        start: `${yr}-${mm}-01`,
        end: ymd(new Date(Number(yr), i + 1, 0)),
      };
    });
    return { title: "Per month", buckets };
  }
  if (period === "month") {
    const monthKey = anchor.slice(0, 7);
    const monthStart = `${monthKey}-01`;
    const monthEnd = ymd(new Date(Number(monthKey.slice(0, 4)), Number(monthKey.slice(5, 7)), 0));
    const buckets: PeriodBucket[] = [];
    let start = weekBounds(monthStart).start;
    while (start <= monthEnd) {
      const { end } = weekBounds(start);
      const lo = start < monthStart ? monthStart : start;
      const hi = end > monthEnd ? monthEnd : end;
      buckets.push({
        key: start,
        label: `W${buckets.length + 1}`,
        name: `${shortDate(lo)} – ${shortDate(hi)}`,
        start: lo,
        end: hi,
      });
      const next = new Date(`${start}T12:00:00`);
      next.setDate(next.getDate() + 7);
      start = ymd(next);
    }
    return { title: "Per week", buckets };
  }
  return null;
}

export function usePeriodNav(initial: Period = "month") {
  const [period, setPeriodRaw] = useState<Period>(initial);
  // Periods stepped away from today (0 = current, negative = past) via the
  // label's arrows; switching the period type snaps back to the present.
  const [offset, setOffset] = useState(0);
  const today = localToday();

  // Anchor date inside the viewed period: today shifted by `offset` periods
  // ("all" has no window to step, so it just pins to today).
  const anchor = useMemo(() => {
    const d = new Date(`${today}T12:00:00`);
    if (period === "week") d.setDate(d.getDate() + offset * 7);
    else if (period === "month") {
      d.setDate(1); // avoid day-31 overflow when stepping months
      d.setMonth(d.getMonth() + offset);
    } else if (period === "year") d.setFullYear(d.getFullYear() + offset);
    return ymd(d);
  }, [today, period, offset]);

  // Stable per (period, anchor) so consumers can key useMemo on it.
  const inPeriod = useCallback(
    (date: string) => {
      if (period === "all") return true;
      if (period === "week") {
        const { start, end } = weekBounds(anchor);
        return date >= start && date <= end;
      }
      return date.startsWith(period === "month" ? anchor.slice(0, 7) : anchor.slice(0, 4));
    },
    [period, anchor],
  );

  const label =
    period === "all"
      ? "All time"
      : period === "week"
        ? (() => {
          const { start, end } = weekBounds(anchor);
          const opts = { month: "short", day: "numeric" } as const;
          return `${new Date(`${start}T12:00:00`).toLocaleDateString(undefined, opts)} – ${new Date(`${end}T12:00:00`).toLocaleDateString(undefined, opts)}`;
        })()
      : period === "month"
        ? new Date(`${anchor}T12:00:00`).toLocaleDateString(undefined, {
            month: "long",
            year: "numeric",
          })
        : anchor.slice(0, 4);

  const setPeriod = useCallback((p: Period) => {
    setPeriodRaw(p);
    setOffset(0);
  }, []);

  const step = useCallback((delta: number) => setOffset((o) => o + delta), []);

  return { period, anchor, label, inPeriod, setPeriod, step };
}

export type PeriodNav = ReturnType<typeof usePeriodNav>;

// Control row above a stats panel, mirroring the Calendar page's switcher:
// ← label → on the left, the week/month/year toggle pushed right. `children`
// render after the toggle (page-level actions like the Add Entry button).
export function PeriodHeader({ nav, children }: { nav: PeriodNav; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-1">
      {/* "All" has nowhere to step, so the arrows drop and the label stands alone. */}
      {nav.period !== "all" && (
        <button
          type="button"
          aria-label="Previous period"
          onClick={() => nav.step(-1)}
          className={quietBtnClass}
        >
          ←
        </button>
      )}
      <span className="px-1 text-sm font-medium text-zinc-100">{nav.label}</span>
      {nav.period !== "all" && (
        <button
          type="button"
          aria-label="Next period"
          onClick={() => nav.step(1)}
          className={quietBtnClass}
        >
          →
        </button>
      )}
      <div className="ml-auto flex items-center gap-2">
        <div className="flex gap-0.5 rounded-lg border border-zinc-700 bg-zinc-800 p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => nav.setPeriod(p)}
              className={`rounded-md px-3 py-1 text-xs capitalize transition-colors ${
                nav.period === p ? "bg-zinc-700 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
        {children}
      </div>
    </div>
  );
}
