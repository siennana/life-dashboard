import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { BOOK_STATUSES, type BookInput, type BookRow, type BookStatus } from "@life/shared";
import { addBook, getBooks, updateBook } from "../api";

// 0.5 .. 5 in half-star steps for the rating dropdown.
const RATINGS = Array.from({ length: 10 }, (_, i) => (i + 1) / 2);

const STATUS_STYLE: Record<BookStatus, string> = {
  reading: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  complete: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  queued: "bg-zinc-700/30 text-zinc-400 ring-zinc-600/30",
  abandoned: "bg-red-500/15 text-red-300 ring-red-500/30",
};

function StatusBadge({ status }: { status: BookStatus }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs capitalize ring-1 ${STATUS_STYLE[status]}`}
    >
      {status}
    </span>
  );
}

// "★★★½" style rating; null renders as an em dash in the table.
function Stars({ rating }: { rating: number | null }) {
  if (rating == null) return <span className="text-zinc-600">—</span>;
  return (
    <span className="whitespace-nowrap text-amber-300" title={`${rating} / 5`}>
      {"★".repeat(Math.floor(rating))}
      {rating % 1 !== 0 && "½"}
    </span>
  );
}

const prettyDate = (d: string | null) =>
  d == null
    ? "—"
    : new Date(`${d}T12:00:00`).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });

const fieldClass =
  "w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none";

function LogForm({ editing, onDone }: { editing: BookRow | null; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [status, setStatus] = useState<BookStatus>("reading");
  const [rating, setRating] = useState("");
  const [log, setLog] = useState("");
  const [dateStarted, setDateStarted] = useState("");
  const [dateCompleted, setDateCompleted] = useState("");

  function clearForm() {
    setTitle("");
    setAuthor("");
    setStatus("reading");
    setRating("");
    setLog("");
    setDateStarted("");
    setDateCompleted("");
  }

  // Entering edit mode prefills the form with the chosen book.
  useEffect(() => {
    if (!editing) return;
    setTitle(editing.title);
    setAuthor(editing.author ?? "");
    setStatus(editing.status);
    setRating(editing.rating != null ? String(editing.rating) : "");
    setLog(editing.log ?? "");
    setDateStarted(editing.dateStarted ?? "");
    setDateCompleted(editing.dateCompleted ?? "");
  }, [editing]);

  const add = useMutation({
    mutationFn: (input: BookInput) =>
      editing ? updateBook(editing.id, input) : addBook(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["books"] });
      clearForm();
      onDone();
    },
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const input: BookInput = {
      title: title.trim(),
      status,
      ...(author.trim() ? { author: author.trim() } : {}),
      ...(rating !== "" ? { rating: Number(rating) } : {}),
      ...(log.trim() ? { log: log.trim() } : {}),
      ...(dateStarted ? { dateStarted } : {}),
      ...(dateCompleted ? { dateCompleted } : {}),
    };
    add.mutate(input);
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-400">
        {editing ? `Editing: ${editing.title}` : "Log a book"}
      </h2>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs text-zinc-500">Title *</span>
          <input
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. The Left Hand of Darkness"
            className={`${fieldClass} mt-1`}
          />
        </label>
        <label className="block">
          <span className="text-xs text-zinc-500">Author</span>
          <input
            type="text"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="e.g. Ursula K. Le Guin"
            className={`${fieldClass} mt-1`}
          />
        </label>
        <label className="block">
          <span className="text-xs text-zinc-500">Status *</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as BookStatus)}
            className={`${fieldClass} mt-1 capitalize`}
          >
            {BOOK_STATUSES.map((s) => (
              <option key={s} value={s} className="capitalize">
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-zinc-500">Rating</span>
          <select
            value={rating}
            onChange={(e) => setRating(e.target.value)}
            className={`${fieldClass} mt-1`}
          >
            <option value="">—</option>
            {RATINGS.map((r) => (
              <option key={r} value={r}>
                {"★".repeat(Math.floor(r))}
                {r % 1 !== 0 ? "½" : ""} ({r})
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-zinc-500">Date started</span>
          <input
            type="date"
            value={dateStarted}
            onChange={(e) => setDateStarted(e.target.value)}
            className={`${fieldClass} mt-1`}
          />
        </label>
        <label className="block">
          <span className="text-xs text-zinc-500">Date completed</span>
          <input
            type="date"
            value={dateCompleted}
            onChange={(e) => setDateCompleted(e.target.value)}
            className={`${fieldClass} mt-1`}
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="text-xs text-zinc-500">Log</span>
          <textarea
            value={log}
            onChange={(e) => setLog(e.target.value)}
            placeholder="Thoughts, review, favorite quotes…"
            rows={3}
            className={`${fieldClass} mt-1 resize-y`}
          />
        </label>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button
          type="submit"
          disabled={add.isPending}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {add.isPending ? "Saving…" : editing ? "Save changes" : "Add book"}
        </button>
        <button
          type="button"
          onClick={() => {
            clearForm();
            onDone();
          }}
          className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
        >
          Cancel
        </button>
        {add.isError && <span className="text-sm text-red-400">{(add.error as Error).message}</span>}
      </div>
    </form>
  );
}

export function Reading() {
  const books = useQuery({ queryKey: ["books"], queryFn: getBooks });
  const rows = books.data?.books ?? [];
  const [editing, setEditing] = useState<BookRow | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  return (
    <>
      <h1 className="text-2xl font-semibold">Reading</h1>
      <p className="mt-1 text-sm text-zinc-400">Track what you're reading and what you thought.</p>

      {formOpen || editing ? (
        <LogForm
          editing={editing}
          onDone={() => {
            setEditing(null);
            setFormOpen(false);
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          className="mt-6 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
        >
          + Add Entry
        </button>
      )}

      <section className="mt-6">
        {books.isPending && <p className="text-zinc-400">Loading…</p>}
        {books.isError && (
          <p className="text-red-400">Couldn't load books — {(books.error as Error).message}</p>
        )}
        {books.isSuccess && rows.length === 0 && (
          <p className="text-zinc-400">No books logged yet — add your first above.</p>
        )}

        {rows.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-xs uppercase tracking-wide text-zinc-500">
                  <th className="px-4 py-3 font-medium">Book</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Rating</th>
                  <th className="px-4 py-3 font-medium">Started</th>
                  <th className="px-4 py-3 font-medium">Completed</th>
                  <th className="px-4 py-3 font-medium">Log</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.id} className="border-b border-zinc-800/50 last:border-0 align-top">
                    <td className="px-4 py-3">
                      <div className="font-medium text-zinc-100">{b.title}</div>
                      {b.author && <div className="text-xs text-zinc-500">{b.author}</div>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <StatusBadge status={b.status} />
                    </td>
                    <td className="px-4 py-3">
                      <Stars rating={b.rating} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-zinc-300">
                      {prettyDate(b.dateStarted)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-zinc-300">
                      {prettyDate(b.dateCompleted)}
                    </td>
                    <td className="px-4 py-3 text-zinc-400">
                      <div className="max-w-[16rem] truncate" title={b.log ?? undefined}>
                        {b.log ?? "—"}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setEditing(b)}
                        className="text-xs text-zinc-500 hover:text-zinc-200"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
