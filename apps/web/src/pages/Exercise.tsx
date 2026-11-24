import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  EXERCISE_TYPES,
  type ExerciseInput,
  type ExerciseRow,
  type ExerciseType,
} from "@life/shared";
import { addExercise, deleteExercise, getExercises, updateExercise } from "../api";
import { SlideDown } from "../components/SlideDown";
import { durationLabel } from "../lib/duration";
import { GRID, INK_MUTED, TipBox, useMeasuredWidth, type Tip } from "../lib/finance";
import { TAG_HEX } from "../lib/tags";
import {
  localToday as today,
  PeriodHeader,
  periodBuckets,
  usePeriodNav,
  type PeriodBucket,
} from "../lib/timeframe";
import { useInlineEdit } from "../lib/useInlineEdit";

const prettyDate = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

// "09:00" -> "9:00 AM"
const prettyTime = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  const d = new Date();
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
};

const fieldClass =
  "w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none";

// Segmented hh:mm:ss duration field — the format is structural (like the
// native time input next to it), so nothing invalid can be typed: digit-only
// segments, mm/ss clamped to 59, focus auto-advances after two digits.
// All-empty = no duration. Emits MINUTES (seconds in the fraction) to match
// how exercise durations are stored.
function DurationInput({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (mins: number | null) => void;
}) {
  const [h, setH] = useState("");
  const [m, setM] = useState("");
  const [s, setS] = useState("");
  const mRef = useRef<HTMLInputElement>(null);
  const sRef = useRef<HTMLInputElement>(null);

  // Adopt external value changes (edit prefill, clear-on-save) without
  // fighting in-progress typing: skip when the prop is what we last emitted.
  const lastEmitted = useRef<number | null>(null);
  useEffect(() => {
    if (value === lastEmitted.current) return;
    lastEmitted.current = value;
    if (value == null) {
      setH("");
      setM("");
      setS("");
      return;
    }
    const total = Math.round(value * 60);
    const hh = Math.floor(total / 3600);
    setH(hh > 0 ? String(hh) : "");
    setM(String(Math.floor((total % 3600) / 60)).padStart(2, "0"));
    setS(String(total % 60).padStart(2, "0"));
  }, [value]);

  function emit(hs: string, ms: string, ss: string) {
    const next =
      hs === "" && ms === "" && ss === ""
        ? null
        : Number(hs || 0) * 60 + Number(ms || 0) + Number(ss || 0) / 60;
    lastEmitted.current = next;
    onChange(next);
  }

  const handle =
    (which: "h" | "m" | "s") => (e: React.ChangeEvent<HTMLInputElement>) => {
      let v = e.target.value.replace(/\D/g, "").slice(0, 2);
      if (which !== "h" && v !== "" && Number(v) > 59) v = "59";
      const [nh, nm, ns] =
        which === "h" ? [v, m, s] : which === "m" ? [h, v, s] : [h, m, v];
      setH(nh);
      setM(nm);
      setS(ns);
      emit(nh, nm, ns);
      if (v.length === 2) {
        const next = which === "h" ? mRef.current : which === "m" ? sRef.current : null;
        next?.focus();
        next?.select();
      }
    };

  // Pad to two digits on blur so a lone "5" settles as "05", like the native
  // control (display only — the emitted minutes don't change). Functional
  // update, because auto-advance blurs the segment in the same tick as its
  // last change and a captured value would stomp it.
  const pad = (set: React.Dispatch<React.SetStateAction<string>>) => () =>
    set((v) => (v.length === 1 ? `0${v}` : v));

  const segClass =
    "w-7 bg-transparent text-center tabular-nums text-zinc-100 placeholder:text-zinc-500 focus:outline-none";
  return (
    <div className="mt-1 flex items-center rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm focus-within:border-zinc-500">
      <input
        type="text"
        inputMode="numeric"
        value={h}
        onChange={handle("h")}
        placeholder="hh"
        aria-label="Hours"
        className={segClass}
      />
      <span className="text-zinc-500">:</span>
      <input
        ref={mRef}
        type="text"
        inputMode="numeric"
        value={m}
        onChange={handle("m")}
        onBlur={pad(setM)}
        placeholder="mm"
        aria-label="Minutes"
        className={segClass}
      />
      <span className="text-zinc-500">:</span>
      <input
        ref={sRef}
        type="text"
        inputMode="numeric"
        value={s}
        onChange={handle("s")}
        onBlur={pad(setS)}
        placeholder="ss"
        aria-label="Seconds"
        className={segClass}
      />
    </div>
  );
}

function LogForm({
  editing,
  onDone,
  inline = false,
}: {
  editing: ExerciseRow | null;
  onDone: () => void;
  inline?: boolean;
}) {
  const queryClient = useQueryClient();
  const [type, setType] = useState<ExerciseType>("run");
  const [date, setDate] = useState(today());
  const [time, setTime] = useState("");
  const [description, setDescription] = useState("");
  const [elapsed, setElapsed] = useState<number | null>(null); // minutes
  const [distance, setDistance] = useState("");
  const [calories, setCalories] = useState("");

  function clearForm() {
    setType("run");
    setDate(today());
    setTime("");
    setDescription("");
    setElapsed(null);
    setDistance("");
    setCalories("");
  }

  // Entering edit mode prefills the form with the chosen workout.
  useEffect(() => {
    if (!editing) return;
    setType(editing.type);
    setDate(editing.date);
    setTime(editing.time ?? "");
    setDescription(editing.description ?? "");
    setElapsed(editing.totalTime ?? null);
    setDistance(editing.distanceMiles != null ? String(editing.distanceMiles) : "");
    setCalories(editing.caloriesBurned != null ? String(editing.caloriesBurned) : "");
  }, [editing]);

  const add = useMutation({
    mutationFn: (input: ExerciseInput) =>
      editing ? updateExercise(editing.id, input) : addExercise(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["exercises"] });
      clearForm();
      onDone();
    },
  });

  const [confirmDelete, setConfirmDelete] = useState(false);
  const del = useMutation({
    mutationFn: () => deleteExercise(editing!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["exercises"] });
      onDone();
    },
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const input: ExerciseInput = {
      type,
      date,
      ...(time !== "" ? { time } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(elapsed != null ? { totalTime: elapsed } : {}),
      ...(distance !== "" ? { distanceMiles: Number(distance) } : {}),
      ...(calories !== "" ? { caloriesBurned: Number(calories) } : {}),
    };
    add.mutate(input);
  }

  return (
    <form
      onSubmit={onSubmit}
      className={`rounded-xl border border-zinc-800 p-5 ${inline ? "bg-zinc-950/60" : "mt-3 bg-zinc-900"}`}
    >
      <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-400">
        {editing ? "Edit workout" : "Log a workout"}
      </h2>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs text-zinc-500">Type *</span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as ExerciseType)}
            className={`${fieldClass} mt-1 capitalize`}
          >
            {EXERCISE_TYPES.map((t) => (
              <option key={t} value={t} className="capitalize">
                {t}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-xs text-zinc-500">Date *</span>
            <input
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={`${fieldClass} mt-1`}
            />
          </label>
          <label className="block">
            <span className="text-xs text-zinc-500">Time of day</span>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className={`${fieldClass} mt-1`}
            />
          </label>
        </div>
        <label className="block sm:col-span-2">
          <span className="text-xs text-zinc-500">Log</span>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. 5k tempo run, felt strong"
            className={`${fieldClass} mt-1`}
          />
        </label>
        <label className="block">
          <span className="text-xs text-zinc-500">Time elapsed</span>
          <DurationInput value={elapsed} onChange={setElapsed} />
        </label>
        <label className="block">
          <span className="text-xs text-zinc-500">Distance (mi)</span>
          <input
            type="number"
            min="0"
            step="any"
            value={distance}
            onChange={(e) => setDistance(e.target.value)}
            placeholder="3.1"
            className={`${fieldClass} mt-1`}
          />
        </label>
        <label className="block">
          <span className="text-xs text-zinc-500">Calories burned</span>
          <input
            type="number"
            min="0"
            step="any"
            value={calories}
            onChange={(e) => setCalories(e.target.value)}
            placeholder="300"
            className={`${fieldClass} mt-1`}
          />
        </label>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button
          type="submit"
          disabled={add.isPending}
          className="cursor-pointer rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {add.isPending ? "Saving…" : editing ? "Save changes" : "Add entry"}
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
                <span className="text-xs text-zinc-400">Delete this workout?</span>
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

// Fixed hue per exercise type for the trend chart + legend, drawn from the
// app's tag palette (the established categorical set — see Bank's Tag trend).
// Skips TAG_HEX.blue: too close to sky when the two land side by side.
const TYPE_HEX: Record<ExerciseType, string> = {
  run: TAG_HEX.sky,
  gym: TAG_HEX.violet,
  yoga: TAG_HEX.emerald,
  aerial: TAG_HEX.pink,
  bike: TAG_HEX.red,
  hike: TAG_HEX.amber,
  custom: TAG_HEX.zinc,
};

// Grouped per-type columns in the Bank tag-trend style: one fixed hue per
// type (color follows the entity), integer day-count ticks, cursor tooltip,
// legend below. Types with no days anywhere in the window drop out.
function TypeChart({ rows, buckets }: { rows: ExerciseRow[]; buckets: PeriodBucket[] }) {
  const [tip, setTip] = useState<Tip>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const { ref: chartRef, width: measured } = useMeasuredWidth<HTMLDivElement>();

  // Distinct workout days per type per bucket.
  const counts = useMemo(
    () =>
      buckets.map((b) => {
        const inB = rows.filter((r) => r.date >= b.start && r.date <= b.end);
        const m = new Map<ExerciseType, number>();
        for (const t of EXERCISE_TYPES)
          m.set(t, new Set(inB.filter((r) => r.type === t).map((r) => r.date)).size);
        return m;
      }),
    [rows, buckets],
  );
  const series = EXERCISE_TYPES.filter((t) => counts.some((m) => (m.get(t) ?? 0) > 0));

  const W = Math.max(measured, 240);
  const H = 150;
  const PAD_L = 24; // counts are small integers, slimmer gutter than $ charts
  const PAD_B = 20;
  const PAD_T = 12;
  const plotW = W - PAD_L - 8;
  const plotH = H - PAD_T - PAD_B;
  const max = Math.max(...counts.flatMap((m) => series.map((t) => m.get(t) ?? 0)), 0);
  // Even integer top so the half tick is a whole day count.
  const top = Math.max(2 * Math.ceil(max / 2), 2);
  const ticks = [0, top / 2, top];
  const slot = plotW / Math.max(buckets.length, 1);
  // Each bucket's group splits the slot between the present types.
  const groupW = Math.min(slot * 0.8, series.length * 14);
  const eachW = groupW / Math.max(series.length, 1);
  const barW = Math.max(eachW - 2, 2);

  function showTip(e: React.PointerEvent, lines: [string, string]) {
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTip({ x: e.clientX - rect.left, y: e.clientY - rect.top - 6, lines });
  }

  if (series.length === 0) {
    return <div className="mt-1 text-sm text-zinc-500">No workouts in this window.</div>;
  }

  return (
    <>
      <div ref={boxRef} className="relative">
        <TipBox tip={tip} />
        <div ref={chartRef}>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="mt-2 w-full"
            role="img"
            aria-label="Workout days per type"
          >
            {ticks.map((t) => {
              const y = PAD_T + plotH * (1 - t / top);
              return (
                <g key={t}>
                  <line x1={PAD_L} x2={W - 8} y1={y} y2={y} stroke={GRID} strokeWidth={1} />
                  <text x={PAD_L - 6} y={y + 3.5} textAnchor="end" fontSize={10} fill={INK_MUTED}>
                    {t}
                  </text>
                </g>
              );
            })}
            {buckets.map((b, i) => {
              const cx = PAD_L + slot * i + slot / 2;
              return (
                <g key={b.key}>
                  {series.map((t, idx) => {
                    const days = counts[i]!.get(t) ?? 0;
                    const h = (days / top) * plotH;
                    if (h <= 0) return null;
                    const x = cx - groupW / 2 + idx * eachW + (eachW - barW) / 2;
                    return (
                      <rect
                        key={t}
                        x={x}
                        y={PAD_T + plotH - h}
                        width={barW}
                        height={h}
                        rx={1.5}
                        fill={TYPE_HEX[t]}
                        onPointerMove={(e) =>
                          showTip(e, [`${days} ${days === 1 ? "day" : "days"}`, `${t} · ${b.name}`])
                        }
                        onPointerLeave={() => setTip(null)}
                      />
                    );
                  })}
                  <text x={cx} y={H - 6} textAnchor="middle" fontSize={10} fill={INK_MUTED}>
                    {b.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
      {/* Legend — multi-hue chart, so every series is named. */}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
        {series.map((t) => (
          <span key={t} className="flex items-center gap-1.5 capitalize">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: TYPE_HEX[t] }} />
            {t}
          </span>
        ))}
      </div>
    </>
  );
}

// Days-per-type totals over the viewed week / month / year, computed from the
// already-loaded exercises (no extra fetch).
// `action` lands in the control row right of the period toggle.
function ExerciseStats({ rows, action }: { rows: ExerciseRow[]; action?: React.ReactNode }) {
  const nav = usePeriodNav();

  const stats = useMemo(() => {
    const inPeriod = rows.filter((r) => nav.inPeriod(r.date));
    // Distinct days per type, most days first (ties keep the enum's order —
    // sort is stable); types with no entries in the period are omitted.
    const daysByType = EXERCISE_TYPES.map((t) => ({
      type: t,
      days: new Set(inPeriod.filter((r) => r.type === t).map((r) => r.date)).size,
    }))
      .filter((x) => x.days > 0)
      .sort((a, b) => b.days - a.days);
    return { daysByType };
  }, [rows, nav.inPeriod]);

  const chart = useMemo(
    () =>
      periodBuckets(
        nav.period,
        nav.anchor,
        rows.map((r) => r.date),
      ),
    [rows, nav.period, nav.anchor],
  );

  return (
    <>
      {/* Calendar-style control row above the card, not inside it. */}
      <PeriodHeader nav={nav}>{action}</PeriodHeader>
      <section className="mt-4 grid grid-cols-3 gap-3">
        {/* One tile for every type's day count (Stat's shell, grid inside). */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Days logged</div>
          {stats.daysByType.length === 0 ? (
            <div className="mt-1 text-lg font-semibold text-zinc-100">0</div>
          ) : (
            <ul className="mt-3 space-y-2">
              {stats.daysByType.map((x) => (
                <li key={x.type} className="flex items-center gap-3 text-sm">
                  <span className="min-w-0 flex-1 truncate capitalize text-zinc-200">{x.type}</span>
                  <span className="shrink-0 text-right tabular-nums text-zinc-100">{x.days}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {chart && (
          <div className="col-span-2 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <div className="text-xs uppercase tracking-wide text-zinc-500">{chart.title}</div>
            <TypeChart rows={rows} buckets={chart.buckets} />
          </div>
        )}
      </section>
    </>
  );
}

export function Exercise() {
  const exercises = useQuery({ queryKey: ["exercises"], queryFn: getExercises });
  const rows = exercises.data?.exercises ?? [];
  const [formOpen, setFormOpen] = useState(false);
  const { editing, closing, open: openEdit, close: closeEdit } = useInlineEdit<ExerciseRow>();

  return (
    // Desktop pins the page to the viewport (main's py-10 = 5rem) so the
    // stats/form stay put and the table scrolls inside its own card; mobile
    // keeps the normal page scroll.
    <div className="flex flex-col md:h-[calc(100dvh-5rem)]">
      <ExerciseStats
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

      <section className="mt-3 flex min-h-0 flex-1 flex-col">
        {exercises.isPending && <p className="text-zinc-400">Loading…</p>}
        {exercises.isError && (
          <p className="text-red-400">Couldn't load exercises — {(exercises.error as Error).message}</p>
        )}
        {exercises.isSuccess && rows.length === 0 && (
          <p className="text-zinc-400">No workouts logged yet — add your first above.</p>
        )}

        {rows.length > 0 && (
          // max-h-full (not flex-1) so a short list keeps a snug border while
          // a long one caps at the leftover height and scrolls internally.
          <div className="max-h-full overflow-x-auto overflow-y-auto rounded-xl border border-zinc-800">
            <table className="w-full text-sm">
              {/* Sticky within the card's scroll, solid bg so rows pass under. */}
              <thead className="sticky top-0 z-10 bg-zinc-900">
                <tr className="border-b border-zinc-800 text-left text-xs uppercase tracking-wide text-zinc-500">
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Log</th>
                  <th className="px-4 py-3 text-right font-medium">Duration</th>
                  <th className="px-4 py-3 text-right font-medium">Distance</th>
                  <th className="px-4 py-3 text-right font-medium">Calories</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isEditing = editing?.id === r.id;
                  return (
                    <Fragment key={r.id}>
                      <tr
                        className={`border-b border-zinc-800/50 last:border-0 ${
                          isEditing ? "bg-zinc-800/40" : ""
                        }`}
                      >
                        <td className="whitespace-nowrap px-4 py-3 text-zinc-300">
                          <div>{prettyDate(r.date)}</div>
                          {r.time != null && (
                            <div className="text-xs text-zinc-500">{prettyTime(r.time)}</div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs capitalize text-zinc-200">
                            {r.type}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-zinc-300">{r.description ?? "—"}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-zinc-300">
                          {r.totalTime == null ? "—" : durationLabel(r.totalTime)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-zinc-300">
                          {r.distanceMiles == null ? "—" : `${r.distanceMiles} mi`}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-zinc-300">
                          {r.caloriesBurned == null ? "—" : `${r.caloriesBurned} cal`}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => (isEditing ? closeEdit() : openEdit(r))}
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
                                <LogForm inline editing={r} onDone={closeEdit} />
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
