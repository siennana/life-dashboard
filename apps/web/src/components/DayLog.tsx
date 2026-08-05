import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getDayLog, saveDayLog } from "../api";

// The per-day free-text log with a Save button. Used in the full day form and
// in the tight week-scan cells. `showLabel` toggles the "Log" heading.
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
      setDirty(false);
    },
  });

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
        placeholder="Notes about the day..."
        className={`min-h-0 flex-1 resize-none rounded-lg border border-zinc-700 bg-zinc-800 p-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none ${
          showLabel ? "mt-1" : ""
        }`}
      />
      <div className="mt-1 flex items-center gap-2">
        <button
          type="button"
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate(log)}
          className="rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {save.isPending ? "Saving…" : "Save"}
        </button>
        {!dirty && !save.isPending && dayLog.isSuccess && (
          <span className="text-[10px] text-zinc-600">Saved</span>
        )}
      </div>
    </div>
  );
}
