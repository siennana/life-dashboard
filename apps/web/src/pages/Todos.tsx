import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  clearCompletedTodos,
  closeTodo,
  deleteTodo,
  getStatusTimed,
  getTodos,
  syncSource,
  type TodoRow,
} from "../api";
import { compareTodos, CompleteButton, DueDate } from "../lib/todos";
import { RefreshIcon } from "../components/SyncStatus";

const fmtDateTime = (d: string | Date) =>
  new Date(d).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

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
      <CompleteButton
        title={todo.title}
        onComplete={() => onComplete(todo.externalId)}
        disabled={disabled}
      />
      <span className="flex-1">{todo.title}</span>
      <DueDate todo={todo} />
    </>
  );
}

// A flat list of todos as a one-level tree: roots + their subtasks (matched by
// parent_id). A child whose parent isn't in the same set is treated as a root.
function buildTree(rows: TodoRow[]): { roots: TodoRow[]; childrenOf: Map<string, TodoRow[]> } {
  const ids = new Set(rows.map((t) => t.externalId));
  const childrenOf = new Map<string, TodoRow[]>();
  const roots: TodoRow[] = [];
  for (const t of rows) {
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
}

// One Todoist list's panel: title + its todo tree. Shared by every list section.
function TodoSection({
  title,
  roots,
  childrenOf,
  collapsed,
  onToggle,
  onComplete,
  disabled,
  className,
}: {
  title: string;
  roots: TodoRow[];
  childrenOf: Map<string, TodoRow[]>;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  onComplete: (externalId: string) => void;
  disabled: boolean;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-zinc-800 bg-zinc-900 p-5 ${className ?? ""}`}>
      <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-400">{title}</h2>
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
                    onClick={() => onToggle(t.externalId)}
                    className="w-4 shrink-0 text-xs text-zinc-500 hover:text-zinc-200"
                  >
                    {open ? "▾" : "▸"}
                  </button>
                ) : (
                  <span className="w-4 shrink-0" />
                )}
                <TodoLeaf todo={t} onComplete={onComplete} disabled={disabled} />
              </div>
              {open && (
                <ul className="ml-8 mt-2 space-y-2 border-l border-zinc-800 pl-3">
                  {kids.map((c) => (
                    <li key={c.externalId} className="flex items-center gap-3 text-sm">
                      <TodoLeaf todo={c} onComplete={onComplete} disabled={disabled} />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// Completed todos: a flat archive (most recent first) with per-row delete and a
// bulk "Clear completed". Deletes only prune the local DB rows.
function CompletedSection({ completed }: { completed: TodoRow[] }) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["todos"] });
  const clear = useMutation({ mutationFn: clearCompletedTodos, onSuccess: invalidate });
  const del = useMutation({ mutationFn: deleteTodo, onSuccess: invalidate });
  if (completed.length === 0) return null;

  return (
    <section className="mt-3 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-400">
          Completed ({completed.length})
        </h2>
        <button
          type="button"
          onClick={() => clear.mutate()}
          disabled={clear.isPending}
          className="cursor-pointer text-xs text-zinc-500 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {clear.isPending ? "Clearing…" : "Clear completed"}
        </button>
      </div>
      <ul className="mt-3 space-y-2">
        {completed.map((t) => (
          <li key={t.externalId} className="flex items-center gap-3 text-sm">
            <span className="min-w-0 flex-1 truncate text-zinc-400 line-through">{t.title}</span>
            <span className="shrink-0 text-xs text-zinc-500">{fmtDateTime(t.updatedAt)}</span>
            <button
              type="button"
              aria-label={`Delete ${t.title}`}
              onClick={() => del.mutate(t.externalId)}
              disabled={del.isPending}
              className="shrink-0 cursor-pointer text-zinc-600 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Todos() {
  const queryClient = useQueryClient();
  const todos = useQuery({ queryKey: ["todos"], queryFn: getTodos });
  const status = useQuery({ queryKey: ["status"], queryFn: getStatusTimed });
  const lastSync = status.data?.processes.find((p) => p.key === "todoist")?.lastRun;
  const complete = useMutation({
    mutationFn: closeTodo,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["todos"] }),
  });
  const sync = useMutation({
    mutationFn: () => syncSource("todoist"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["todos"] });
      queryClient.invalidateQueries({ queryKey: ["status"] });
    },
  });
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  // Open todos grouped by their Todoist list, each built into its own tree.
  // Inbox leads; every other list follows alphabetically.
  const listSections = useMemo(() => {
    const open = todos.data?.todos.filter((t) => t.payload?.status !== "completed") ?? [];
    const byList = new Map<string, TodoRow[]>();
    for (const t of open) {
      const list = t.payload?.list ?? "Other";
      const arr = byList.get(list) ?? [];
      arr.push(t);
      byList.set(list, arr);
    }
    const names = [...byList.keys()].sort((a, b) =>
      a === "Inbox" ? -1 : b === "Inbox" ? 1 : a.localeCompare(b),
    );
    return names.map((name) => ({ name, ...buildTree(byList.get(name)!) }));
  }, [todos.data]);

  // Completed todos, newest completion first (updatedAt = completion time).
  const completed = useMemo(
    () =>
      (todos.data?.todos ?? [])
        .filter((t) => t.payload?.status === "completed")
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [todos.data],
  );

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
      <div className="mt-1 flex items-baseline justify-between">
        <p className="text-sm text-zinc-400">
          {new Date().toLocaleDateString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </p>
        <div className="flex items-center gap-3">
          {lastSync && (
            <p className="text-xs text-zinc-500">Last sync: {fmtDateTime(lastSync)}</p>
          )}
          <button
            type="button"
            onClick={() => sync.mutate()}
            disabled={sync.isPending}
            aria-label="Sync Todoist"
            title="Sync Todoist"
            className="cursor-pointer text-zinc-500 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshIcon spinning={sync.isPending} />
          </button>
        </div>
      </div>

      {todos.isPending && <p className="mt-3 text-zinc-400">Loading…</p>}
      {todos.isError && (
        <p className="mt-3 text-red-400">Couldn't load todos — {(todos.error as Error).message}</p>
      )}
      {todos.isSuccess && listSections.length === 0 && (
        <p className="mt-3 text-zinc-400">
          All clear — add todos in Todoist and they'll appear within 5 minutes.
        </p>
      )}

      {listSections.map((section) => (
        <TodoSection
          key={section.name}
          className="mt-3"
          title={section.name}
          roots={section.roots}
          childrenOf={section.childrenOf}
          collapsed={collapsed}
          onToggle={toggle}
          onComplete={complete.mutate}
          disabled={complete.isPending}
        />
      ))}

      <CompletedSection completed={completed} />
    </>
  );
}
