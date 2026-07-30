import { Link } from "react-router-dom";
import { DayChips, dateKey, useDayData, WEEKDAYS } from "../lib/calendar";

// The 7 days of the current Mon–Sun week.
function currentWeek(base: Date) {
  const dow = (base.getDay() + 6) % 7; // Mon=0
  const monday = new Date(base);
  monday.setDate(base.getDate() - dow);
  const todayKey = dateKey(base.getFullYear(), base.getMonth(), base.getDate());
  return Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(monday);
    dt.setDate(monday.getDate() + i);
    const key = dateKey(dt.getFullYear(), dt.getMonth(), dt.getDate());
    return { key, day: dt.getDate(), isToday: key === todayKey };
  });
}

export function WeekCalendar() {
  // Same source as the full calendar — fetching + grouping live in useDayData.
  const { byDay, eventsByDay, exercises } = useDayData();
  const days = currentWeek(new Date());

  return (
    <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-400">This week</h2>
        <Link to="/calendar" className="text-xs text-zinc-500 hover:text-zinc-300">
          Full calendar →
        </Link>
      </div>

      {exercises.isError && (
        <p className="mt-3 text-sm text-red-400">
          Couldn't load — {(exercises.error as Error).message}
        </p>
      )}

      {/* Mirrors the full calendar's grid: bordered cells, weekday header,
          day number pinned top-left, chips below — minus the interactivity. */}
      <div className="mt-4 overflow-hidden rounded-xl border border-zinc-800">
        <div className="grid grid-cols-7 border-b border-zinc-800 bg-zinc-900">
          {WEEKDAYS.map((d) => (
            <div
              key={d}
              className="px-2 py-2 text-center text-xs font-medium uppercase tracking-wide text-zinc-500"
            >
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d) => (
            <div
              key={d.key}
              className="flex min-h-24 min-w-0 flex-col border-r border-zinc-800/60 bg-zinc-900 p-1.5 last:border-r-0"
            >
              <span
                className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${
                  d.isToday ? "bg-emerald-600 font-semibold text-white" : "text-zinc-300"
                }`}
              >
                {d.day}
              </span>
              <DayChips dayEvents={eventsByDay.get(d.key) ?? []} entries={byDay.get(d.key) ?? []} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
