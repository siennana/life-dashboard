// Exercise durations are stored as MINUTES (fractional — seconds ride in the
// fraction), which keeps the schedule timeline's minute math and all stored
// rows unchanged. The form's segmented hh:mm:ss field (DurationInput in
// Exercise.tsx) emits that unit directly.

// Compact display: "1h 35m 42s" with zero units omitted — "30m", "1h 35m",
// "32m 45s". Shared by the exercise table, calendar chips, and schedule.
export function durationLabel(mins: number): string {
  const total = Math.round(mins * 60);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts = [h > 0 ? `${h}h` : null, m > 0 ? `${m}m` : null, s > 0 ? `${s}s` : null].filter(
    Boolean,
  );
  return parts.length > 0 ? parts.join(" ") : "0m";
}
