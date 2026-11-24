import type { CalendarEvent } from "@life/shared";
import { ScheduleTimeline } from "./ScheduleTimeline";

// Expanded-week scan: a seven-column ScheduleTimeline sharing the whole
// timeline (and its schedule) with the single-day view. Hour labels live in a
// left gutter so all columns line up under one scrollbar.
export function WeekSchedule({
  dates,
  gutter,
  onDateContextMenu,
  onEventContextMenu,
  showExercise,
  hiddenCalendars,
  hiddenEventTags,
}: {
  dates: string[];
  gutter: number;
  onDateContextMenu?: (e: React.MouseEvent, date: string) => void;
  onEventContextMenu?: (e: React.MouseEvent, event: CalendarEvent) => void;
  showExercise?: boolean;
  hiddenCalendars?: ReadonlySet<string>;
  hiddenEventTags?: ReadonlySet<number>;
}) {
  return (
    <ScheduleTimeline
      dates={dates}
      gutter={gutter}
      className="min-h-0 flex-1"
      onDateContextMenu={onDateContextMenu}
      onEventContextMenu={onEventContextMenu}
      showExercise={showExercise}
      hiddenCalendars={hiddenCalendars}
      hiddenEventTags={hiddenEventTags}
    />
  );
}
