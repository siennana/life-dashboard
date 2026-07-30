import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { closeTodo, getTodos } from "../api";
import { CompleteButton, DueDate, dueOf, localToday } from "../lib/todos";

export function TodosWidget() {
  const queryClient = useQueryClient();
  // Same query as the Todos page (React Query dedupes by key).
  const todos = useQuery({ queryKey: ["todos"], queryFn: getTodos });
  const complete = useMutation({
    mutationFn: closeTodo,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["todos"] }),
  });
  const today = localToday();
  const due = (todos.data?.todos ?? [])
    .filter((t) => t.payload?.status !== "completed")
    .filter((t) => {
      const d = dueOf(t);
      return d != null && d <= today;
    })
    .sort((a, b) => (dueOf(a) as string).localeCompare(dueOf(b) as string));

  // Absolute inner + min-h keeps this the same height as the finance widget
  // beside it (its content doesn't grow the row); the list scrolls instead.
  return (
    <section className="relative min-h-[14rem] overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
      <div className="absolute inset-0 flex flex-col p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-400">
            Due &amp; overdue
          </h2>
          <Link to="/todos" className="text-xs text-zinc-500 hover:text-zinc-300">
            All todos →
          </Link>
        </div>

        {todos.isPending && <p className="mt-3 text-zinc-400">Loading…</p>}
        {todos.isError && (
          <p className="mt-3 text-red-400">Couldn't load — {(todos.error as Error).message}</p>
        )}
        {todos.isSuccess && due.length === 0 && (
          <p className="mt-3 text-sm text-zinc-400">Nothing due. Nice.</p>
        )}
        {due.length > 0 && (
          <ul className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {due.map((t) => (
              <li key={t.externalId} className="flex items-center gap-3 text-sm">
                <CompleteButton
                  title={t.title}
                  onComplete={() => complete.mutate(t.externalId)}
                  disabled={complete.isPending}
                />
                <span className="flex-1 truncate">{t.title}</span>
                <DueDate todo={t} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
