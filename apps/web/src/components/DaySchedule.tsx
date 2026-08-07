import { ScheduleTimeline } from "./ScheduleTimeline";

// Expanded-day schedule: a single-column ScheduleTimeline (the same component
// the week scan uses), so the day and week views can never show different
// schedules. `showLabel` toggles the "Schedule" heading.
export function DaySchedule({ date, showLabel = true }: { date: string; showLabel?: boolean }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {showLabel && (
        <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
          Schedule
        </span>
      )}
      <ScheduleTimeline dates={[date]} gutter={34} className="min-h-16 flex-1" />
    </div>
  );
}
