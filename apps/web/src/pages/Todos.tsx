import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { closeTodo, getTodos, type TodoRow } from "../api";

// Local calendar date as YYYY-MM-DD.
function localToday(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

const dueOf = (t: TodoRow) => t.payload?.due?.date?.slice(0, 10) ?? null;
const addedOf = (t: TodoRow) => t.payload?.added_at ?? t.startTs;

// Dated todos first (earliest due first); undated ones sink to the bottom,
// ordered among themselves by date added.
function compareTodos(a: TodoRow, b: TodoRow): number {
  const da = dueOf(a);
  const db = dueOf(b);
  if (da && db) return da.localeCompare(db);
  if (da) return -1;
  if (db) return 1;
  return addedOf(a).localeCompare(addedOf(b));
}

// Due date on the right: red if overdue, green if today, grey otherwise.
function DueDate({ todo }: { todo: TodoRow }) {
  const due = dueOf(todo);
  if (!due) return null;
  const today = localToday();
  const color = due < today ? "text-red-400" : due === today ? "text-emerald-400" : "text-zinc-500";
  const label = new Date(`${due}T12:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return <span className={`shrink-0 text-xs ${color}`}>{label}</span>;
}

// One todo's row content (complete circle + title + due), shared by parent rows
// and subtask rows.
function TodoLeaf({
  todo,
  onComplete,
  disabled,
}: {
  todo: TodoRow;
  onComplete: (externalId: string) => void;
  disabled: boolean;
}) {
  return (
    <>
      <button
        type="button"
        aria-label={`Complete ${todo.title}`}
        disabled={disabled}
        onClick={() => onComplete(todo.externalId)}
        className="h-4 w-4 shrink-0 rounded-full border border-zinc-600 hover:border-emerald-400 hover:bg-emerald-400/20 disabled:opacity-50"
      />
      <span className="flex-1">{todo.title}</span>
      <DueDate todo={todo} />
    </>
  );
}

export function Todos() {
  const queryClient = useQueryClient();
  const todos = useQuery({ queryKey: ["todos"], queryFn: getTodos });
  const complete = useMutation({
    mutationFn: closeTodo,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["todos"] }),
  });
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  // Inbox todos as a one-level tree: roots + their subtasks (matched by
  // parent_id). A child whose parent isn't in the set is treated as a root.
  const { roots, childrenOf } = useMemo(() => {
    const inbox =
      todos.data?.todos.filter(
        (t) => t.payload?.status !== "completed" && t.payload?.list === "Inbox",
      ) ?? [];
    const ids = new Set(inbox.map((t) => t.externalId));
    const childrenOf = new Map<string, TodoRow[]>();
    const roots: TodoRow[] = [];
    for (const t of inbox) {
      const parent = t.payload?.parent_id ?? null;
      if (parent && ids.has(parent)) {
        const arr = childrenOf.get(parent) ?? [];
        arr.push(t);
        childrenOf.set(parent, arr);
      } else {
        roots.push(t);
      }
    }
    roots.sort(compareTodos);
    for (const arr of childrenOf.values()) arr.sort(compareTodos);
    return { roots, childrenOf };
  }, [todos.data]);

  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      <p className="mt-1 text-sm text-zinc-400">
        {new Date().toLocaleDateString(undefined, {
          weekday: "long",
          month: "long",
          day: "numeric",
        })}
      </p>

      <section className="mt-8 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-400">Inbox</h2>
        {todos.isPending && <p className="mt-3 text-zinc-400">Loading…</p>}
        {todos.isError && (
          <p className="mt-3 text-red-400">
            Couldn't load todos — {(todos.error as Error).message}
          </p>
        )}
        {todos.isSuccess && roots.length === 0 && (
          <p className="mt-3 text-zinc-400">
            All clear — add todos in Todoist and they'll appear within 5 minutes.
          </p>
        )}
        {roots.length > 0 && (
          <ul className="mt-3 space-y-2">
            {roots.map((t) => {
              const kids = childrenOf.get(t.externalId) ?? [];
              const open = kids.length > 0 && !collapsed.has(t.externalId);
              return (
                <li key={t.externalId}>
                  <div className="flex items-center gap-3 text-sm">
                    {kids.length > 0 ? (
                      <button
                        type="button"
                        aria-label={open ? "Collapse subtasks" : "Expand subtasks"}
                        aria-expanded={open}
                        onClick={() => toggle(t.externalId)}
                        className="w-4 shrink-0 text-xs text-zinc-500 hover:text-zinc-200"
                      >
                        {open ? "▾" : "▸"}
                      </button>
                    ) : (
                      <span className="w-4 shrink-0" />
                    )}
                    <TodoLeaf todo={t} onComplete={complete.mutate} disabled={complete.isPending} />
                  </div>
                  {open && (
                    <ul className="ml-8 mt-2 space-y-2 border-l border-zinc-800 pl-3">
                      {kids.map((c) => (
                        <li key={c.externalId} className="flex items-center gap-3 text-sm">
                          <TodoLeaf
                            todo={c}
                            onComplete={complete.mutate}
                            disabled={complete.isPending}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
