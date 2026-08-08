import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getDayLog, saveDayLog } from "../api";

// The per-day free-text log. No Save button — it autosaves on blur (clicking
// out of the field). The text is greyed while locked and turns white on focus
// (`focus:text-zinc-100`) to signal edit mode. `showLabel` toggles the heading.
export function DayLog({ date, showLabel = true }: { date: string; showLabel?: boolean }) {
  const queryClient = useQueryClient();
  const dayLog = useQuery({ queryKey: ["day-log", date], queryFn: () => getDayLog(date) });
  const [log, setLog] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setLog(dayLog.data?.log ?? "");
    setDirty(false);
  }, [dayLog.data, date]);

  const save = useMutation({
    mutationFn: (value: string) => saveDayLog(date, value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["day-log", date] });
      // Refresh the page-level "last saved" stamp.
      queryClient.invalidateQueries({ queryKey: ["calendar-last-updated"] });
      setDirty(false);
    },
  });

  // Autosave when leaving the field, only if the text actually changed.
  function handleBlur() {
    if (dirty && !save.isPending) save.mutate(log);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {showLabel && (
        <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">Log</span>
      )}
      <textarea
        value={log}
        onChange={(e) => {
          setLog(e.target.value);
          setDirty(true);
        }}
        onBlur={handleBlur}
        placeholder="Notes about the day..."
        // min-h-24 keeps the field usable when the column is content-sized
        // (mobile day view); md+ containers are fixed-height, flex-1 rules.
        className="min-h-24 flex-1 resize-none rounded-lg border border-zinc-700 bg-zinc-800 p-2 text-xs text-zinc-400 placeholder:text-zinc-500 focus:border-zinc-500 focus:text-zinc-100 focus:outline-none md:min-h-0"
      />
    </div>
  );
}
