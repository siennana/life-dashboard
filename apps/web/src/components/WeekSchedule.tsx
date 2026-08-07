import { ScheduleTimeline } from "./ScheduleTimeline";

// Expanded-week scan: a seven-column ScheduleTimeline sharing the whole
// timeline (and its schedule) with the single-day view. Hour labels live in a
// left gutter so all columns line up under one scrollbar.
export function WeekSchedule({
  dates,
  gutter,
  onDateContextMenu,
}: {
  dates: string[];
  gutter: number;
  onDateContextMenu?: (e: React.MouseEvent, date: string) => void;
}) {
  return (
    <ScheduleTimeline
      dates={dates}
      gutter={gutter}
      className="min-h-0 flex-1"
      onDateContextMenu={onDateContextMenu}
    />
  );
}
