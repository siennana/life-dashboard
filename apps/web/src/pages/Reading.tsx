import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { BOOK_STATUSES, type BookInput, type BookRow, type BookStatus } from "@life/shared";
import { addBook, deleteBook, getBooks, updateBook } from "../api";
import { SlideDown } from "../components/SlideDown";
import { Stat } from "../components/Stat";
import { ACCENT, GRID, INK_MUTED, TipBox, useMeasuredWidth, type Tip } from "../lib/finance";
import { PeriodHeader, periodBuckets, usePeriodNav, type PeriodBucket } from "../lib/timeframe";
import { useInlineEdit } from "../lib/useInlineEdit";

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

function LogForm({
  editing,
  onDone,
  inline = false,
}: {
  editing: BookRow | null;
  onDone: () => void;
  inline?: boolean;
}) {
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

  const [confirmDelete, setConfirmDelete] = useState(false);
  const del = useMutation({
    mutationFn: () => deleteBook(editing!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["books"] });
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
    <form
      onSubmit={onSubmit}
      className={`rounded-xl border border-zinc-800 p-5 ${inline ? "bg-zinc-950/60" : "mt-6 bg-zinc-900"}`}
    >
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
          className="cursor-pointer rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
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
        {editing && (
          <div className="ml-auto flex items-center gap-2">
            {del.isError && (
              <span className="text-xs text-red-400">{(del.error as Error).message}</span>
            )}
            {confirmDelete ? (
              <>
                <span className="text-xs text-zinc-400">Delete this book?</span>
                <button
                  type="button"
                  onClick={() => del.mutate()}
                  disabled={del.isPending}
                  className="cursor-pointer rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {del.isPending ? "Deleting…" : "Confirm"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
                >
                  Keep
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="cursor-pointer rounded-lg border border-red-900/60 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-950/40"
              >
                Delete
              </button>
            )}
          </div>
        )}
      </div>
    </form>
  );
}

type ChartBucket = PeriodBucket & { count: number };

// Columns in the Bank monthly-trend style: integer count ticks on a y axis,
// hairline grid, single accent, hover tooltip per column. Measured width so
// text stays true-pixel in the 2/3-width tile.
function BooksChart({ buckets }: { buckets: ChartBucket[] }) {
  const [tip, setTip] = useState<Tip>(null);
  const ref = useRef<SVGSVGElement>(null);
  const { ref: boxRef, width: measured } = useMeasuredWidth<HTMLDivElement>();
  const W = Math.max(measured, 240);
  const H = 130;
  const PAD_L = 24; // counts are small integers, slimmer gutter than $ charts
  const PAD_B = 20;
  const PAD_T = 12;
  const plotW = W - PAD_L - 8;
  const plotH = H - PAD_T - PAD_B;
  const max = Math.max(...buckets.map((b) => b.count));
  // Even integer top so the half tick is a whole book count.
  const top = Math.max(2 * Math.ceil(max / 2), 2);
  const ticks = [0, top / 2, top];
  const slot = plotW / Math.max(buckets.length, 1);
  const barW = Math.min(24, slot * 0.6);
  const y = (v: number) => PAD_T + plotH * (1 - v / top);

  return (
    <div ref={boxRef} className="relative">
      <TipBox tip={tip} />
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        className="mt-2 w-full"
        role="img"
        aria-label="Books read"
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD_L} x2={W - 8} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
            <text x={PAD_L - 6} y={y(t) + 3.5} textAnchor="end" fontSize={10} fill={INK_MUTED}>
              {t}
            </text>
          </g>
        ))}
        {buckets.map((b, i) => {
          const cx = PAD_L + slot * i + slot / 2;
          return (
            <g key={b.key}>
              {/* hit target: full slot height, wider than the bar */}
              <rect
                x={cx - slot / 2}
                y={PAD_T}
                width={slot}
                height={plotH + PAD_B}
                fill="transparent"
                onPointerMove={() => {
                  const rect = ref.current?.getBoundingClientRect();
                  if (!rect) return;
                  setTip({
                    x: (cx / W) * rect.width,
                    y: (y(b.count) / H) * rect.height,
                    lines: [`${b.count} ${b.count === 1 ? "book" : "books"}`, b.name],
                  });
                }}
                onPointerLeave={() => setTip(null)}
              />
              {b.count > 0 && (
                /* 4px rounded data-end, square baseline: round top corners only */
                <path
                  d={`M ${cx - barW / 2} ${y(0)}
                      L ${cx - barW / 2} ${y(b.count) + 4}
                      Q ${cx - barW / 2} ${y(b.count)} ${cx - barW / 2 + 4} ${y(b.count)}
                      L ${cx + barW / 2 - 4} ${y(b.count)}
                      Q ${cx + barW / 2} ${y(b.count)} ${cx + barW / 2} ${y(b.count) + 4}
                      L ${cx + barW / 2} ${y(0)} Z`}
                  fill={ACCENT}
                  style={{ pointerEvents: "none" }}
                />
              )}
              <text x={cx} y={H - 6} textAnchor="middle" fontSize={10} fill={INK_MUTED}>
                {b.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// Books completed in the viewed week / month / year, from the already-loaded
// list (no extra fetch). Defaults to year — a month is usually 0–2 books.
// `action` lands in the control row right of the period toggle.
function ReadingStats({ rows, action }: { rows: BookRow[]; action?: React.ReactNode }) {
  const nav = usePeriodNav("year");

  const completions = useMemo(
    () =>
      rows
        .filter((b) => b.status === "complete" && b.dateCompleted != null)
        .map((b) => b.dateCompleted as string),
    [rows],
  );
  const booksRead = useMemo(
    () => completions.filter((d) => nav.inPeriod(d)).length,
    [completions, nav.inPeriod],
  );
  const chart = useMemo(() => {
    const b = periodBuckets(nav.period, nav.anchor, completions);
    return {
      title: b.title,
      buckets: b.buckets.map(
        (bk): ChartBucket => ({
          ...bk,
          count: completions.filter((d) => d >= bk.start && d <= bk.end).length,
        }),
      ),
    };
  }, [completions, nav.period, nav.anchor]);

  return (
    <>
      {/* Calendar-style control row above the card, not inside it. */}
      <PeriodHeader nav={nav}>{action}</PeriodHeader>
      <section className="mt-4 grid grid-cols-3 gap-3">
        <Stat label="Books read" value={booksRead.toLocaleString()} />
        <div className="col-span-2 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="text-xs uppercase tracking-wide text-zinc-500">{chart.title}</div>
          {chart.buckets.length === 0 ? (
            <div className="mt-1 text-sm text-zinc-500">No completed books yet.</div>
          ) : (
            <BooksChart buckets={chart.buckets} />
          )}
        </div>
      </section>
    </>
  );
}

export function Reading() {
  const books = useQuery({ queryKey: ["books"], queryFn: getBooks });
  const rows = books.data?.books ?? [];
  const { editing, closing, open: openEdit, close: closeEdit } = useInlineEdit<BookRow>();
  const [formOpen, setFormOpen] = useState(false);

  return (
    // Desktop pins the page to the viewport (main's py-10 = 5rem) so the
    // entry button/form stay put and the table scrolls inside its own card;
    // mobile keeps the normal page scroll.
    <div className="flex flex-col md:h-[calc(100dvh-5rem)]">
      <ReadingStats
        rows={rows}
        action={
          !formOpen && (
            <button
              type="button"
              onClick={() => setFormOpen(true)}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
            >
              + Add Entry
            </button>
          )
        }
      />

      {formOpen && <LogForm editing={null} onDone={() => setFormOpen(false)} />}

      <section className="mt-6 flex min-h-0 flex-1 flex-col">
        {books.isPending && <p className="text-zinc-400">Loading…</p>}
        {books.isError && (
          <p className="text-red-400">Couldn't load books — {(books.error as Error).message}</p>
        )}
        {books.isSuccess && rows.length === 0 && (
          <p className="text-zinc-400">No books logged yet — add your first above.</p>
        )}

        {rows.length > 0 && (
          // max-h-full (not flex-1) so a short list keeps a snug border while
          // a long one caps at the leftover height and scrolls internally.
          <div className="max-h-full overflow-x-auto overflow-y-auto rounded-xl border border-zinc-800">
            <table className="w-full text-sm">
              {/* Sticky within the card's scroll, solid bg so rows pass under. */}
              <thead className="sticky top-0 z-10 bg-zinc-900">
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
                {rows.map((b) => {
                  const isEditing = editing?.id === b.id;
                  return (
                    <Fragment key={b.id}>
                      <tr
                        className={`border-b border-zinc-800/50 last:border-0 align-top ${
                          isEditing ? "bg-zinc-800/40" : ""
                        }`}
                      >
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
                            onClick={() => (isEditing ? closeEdit() : openEdit(b))}
                            className="text-xs text-zinc-500 hover:text-zinc-200"
                          >
                            {isEditing ? "Close" : "Edit"}
                          </button>
                        </td>
                      </tr>
                      {isEditing && (
                        <tr className="bg-zinc-800/40">
                          <td colSpan={7} className="p-0">
                            <SlideDown open={!closing}>
                              <div className="px-3 pb-3">
                                <LogForm inline editing={b} onDone={closeEdit} />
                              </div>
                            </SlideDown>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
