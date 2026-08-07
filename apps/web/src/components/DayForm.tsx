import { useMutation, useQueryClient } from "@tanstack/react-query";
import { closeTodo } from "../api";
import { CompleteButton, useTodosDueOn } from "../lib/todos";
import { DaySchedule } from "./DaySchedule";
import { DayLog } from "./DayLog";

// Todoist todos due on this day — shares the ["todos"] query with the Todos
// page/widget, so nothing extra is fetched to populate this.
function TodosForDay({ date }: { date: string }) {
  const queryClient = useQueryClient();
  const { due, completed } = useTodosDueOn(date);
  const complete = useMutation({
    mutationFn: closeTodo,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["todos"] }),
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">Todos</span>
      <div className="mt-1 min-h-16 flex-1 overflow-y-auto rounded-lg border border-dashed border-zinc-700 p-2">
        {due.length === 0 && completed.length === 0 ? (
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
            {completed.map((t) => (
              <li key={t.externalId} className="flex items-center gap-2 text-xs">
                <span
                  aria-hidden="true"
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-[9px] text-emerald-400"
                >
                  ✓
                </span>
                <span className="flex-1 truncate text-zinc-500 line-through">{t.title}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// The widened-day form. Left column: log + todos. Right column: schedule.
export function DayForm({ date }: { date: string }) {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
      <div className="flex min-h-0 flex-col gap-3">
        <DayLog date={date} />
        <TodosForDay date={date} />
      </div>
      <DaySchedule date={date} />
    </div>
  );
}
