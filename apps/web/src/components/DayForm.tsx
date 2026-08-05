import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { closeTodo, getDayLog, saveDayLog } from "../api";
import { CompleteButton, useTodosDueOn } from "../lib/todos";

function Placeholder({ label }: { label: string }) {
  return (
    <div className="flex-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{label}</span>
      <div className="mt-1 flex h-full min-h-16 items-center justify-center rounded-lg border border-dashed border-zinc-700 text-[11px] text-zinc-600">
        Coming soon
      </div>
    </div>
  );
}

// Todoist todos due on this day — shares the ["todos"] query with the Todos
// page/widget, so nothing extra is fetched to populate this.
function TodosForDay({ date }: { date: string }) {
  const queryClient = useQueryClient();
  const { due } = useTodosDueOn(date);
  const complete = useMutation({
    mutationFn: closeTodo,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["todos"] }),
  });

  return (
    <div className="flex-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">Todos</span>
      <div className="mt-1 min-h-16 overflow-y-auto rounded-lg border border-dashed border-zinc-700 p-2">
        {due.length === 0 ? (
          <div className="flex h-full min-h-12 items-center justify-center text-[11px] text-zinc-600">
            None due
          </div>
        ) : (
          <ul className="space-y-1.5">
            {due.map((t) => (
              <li key={t.externalId} className="flex items-center gap-2 text-xs">
                <CompleteButton
                  title={t.title}
                  onComplete={() => complete.mutate(t.externalId)}
                  disabled={complete.isPending}
                />
                <span className="flex-1 truncate text-zinc-200">{t.title}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// The expanded-day-cell form: log (implemented) + todos/schedule placeholders.
// Left column: log + todos. Right column: schedule.
export function DayForm({ date }: { date: string }) {
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
    // stopPropagation: the day cell isn't a <button> while expanded, but this
    // still guards against clicks bubbling to any future container handler.
    <div
      className="mt-2 grid min-h-0 flex-1 grid-cols-2 gap-3"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex min-h-0 flex-col gap-3">
        <div className="flex min-h-0 flex-1 flex-col">
          <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">Log</span>
          <textarea
            value={log}
            onChange={(e) => {
              setLog(e.target.value);
              setDirty(true);
            }}
            placeholder="Notes about the day..."
            className="mt-1 min-h-0 flex-1 resize-none rounded-lg border border-zinc-700 bg-zinc-800 p-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none"
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
        <TodosForDay date={date} />
      </div>
      <Placeholder label="Schedule" />
    </div>
  );
}
