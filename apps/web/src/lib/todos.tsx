import type { TodoRow } from "../api";

// Shared todo helpers, used by the Todos page and the Home "due & overdue"
// widget so the due-date logic and rendering live once.

// Local calendar date as YYYY-MM-DD.
export function localToday(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export const dueOf = (t: TodoRow) => t.payload?.due?.date?.slice(0, 10) ?? null;
export const addedOf = (t: TodoRow) => t.payload?.added_at ?? t.startTs;

// Dated todos first (earliest due first); undated ones sink to the bottom,
// ordered among themselves by date added.
export function compareTodos(a: TodoRow, b: TodoRow): number {
  const da = dueOf(a);
  const db = dueOf(b);
  if (da && db) return da.localeCompare(db);
  if (da) return -1;
  if (db) return 1;
  return addedOf(a).localeCompare(addedOf(b));
}

// The complete-todo circle, shared by the Todos page and the Home widget.
export function CompleteButton({
  title,
  onComplete,
  disabled,
}: {
  title: string | null;
  onComplete: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={`Complete ${title ?? "todo"}`}
      disabled={disabled}
      onClick={onComplete}
      className="h-4 w-4 shrink-0 rounded-full border border-zinc-600 hover:border-emerald-400 hover:bg-emerald-400/20 disabled:opacity-50"
    />
  );
}

// Due date badge: red if overdue, green if today, grey otherwise.
export function DueDate({ todo }: { todo: TodoRow }) {
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
