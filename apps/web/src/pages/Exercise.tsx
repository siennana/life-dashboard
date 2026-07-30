import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  EXERCISE_TYPES,
  type ExerciseInput,
  type ExerciseRow,
  type ExerciseType,
} from "@life/shared";
import { addExercise, getExercises, updateExercise } from "../api";
import { Stat } from "../components/Stat";

// Local calendar date as YYYY-MM-DD (so "today" matches the user's clock, not UTC).
function today(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

const prettyDate = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

const fieldClass =
  "w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none";

function LogForm({ editing, onDone }: { editing: ExerciseRow | null; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [type, setType] = useState<ExerciseType>("run");
  const [date, setDate] = useState(today());
  const [description, setDescription] = useState("");
  const [totalTime, setTotalTime] = useState("");
  const [distance, setDistance] = useState("");
  const [calories, setCalories] = useState("");

  function clearForm() {
    setType("run");
    setDate(today());
    setDescription("");
    setTotalTime("");
    setDistance("");
    setCalories("");
  }

  // Entering edit mode prefills the form with the chosen workout.
  useEffect(() => {
    if (!editing) return;
    setType(editing.type);
    setDate(editing.date);
    setDescription(editing.description ?? "");
    setTotalTime(editing.totalTime != null ? String(editing.totalTime) : "");
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

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const input: ExerciseInput = {
      type,
      date,
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(totalTime !== "" ? { totalTime: Number(totalTime) } : {}),
      ...(distance !== "" ? { distanceMiles: Number(distance) } : {}),
      ...(calories !== "" ? { caloriesBurned: Number(calories) } : {}),
    };
    add.mutate(input);
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900 p-5"
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
          <span className="text-xs text-zinc-500">Total time (min)</span>
          <input
            type="number"
            min="0"
            step="any"
            value={totalTime}
            onChange={(e) => setTotalTime(e.target.value)}
            placeholder="30"
            className={`${fieldClass} mt-1`}
          />
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
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
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
      </div>
    </form>
  );
}

type Period = "day" | "month" | "year";
const PERIODS: Period[] = ["day", "month", "year"];

// Totals over the current day / month / year, computed from the already-loaded
// exercises (no extra fetch). Miles sums distance across all workout types.
function ExerciseStats({ rows }: { rows: ExerciseRow[] }) {
  const [period, setPeriod] = useState<Period>("month");
  const localToday = today();

  const stats = useMemo(() => {
    const prefix = period === "day" ? localToday : period === "month" ? localToday.slice(0, 7) : localToday.slice(0, 4);
    const inPeriod = rows.filter((r) => r.date.startsWith(prefix));
    return {
      daysLogged: new Set(inPeriod.map((r) => r.date)).size,
      miles: inPeriod.reduce((sum, r) => sum + (r.distanceMiles ?? 0), 0),
      totalMinutes: inPeriod.reduce((sum, r) => sum + (r.totalTime ?? 0), 0),
    };
  }, [rows, period, localToday]);

  const periodLabel =
    period === "day"
      ? prettyDate(localToday)
      : period === "month"
        ? new Date(`${localToday}T12:00:00`).toLocaleDateString(undefined, {
            month: "long",
            year: "numeric",
          })
        : localToday.slice(0, 4);

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-400">Statistics</h2>
          <p className="mt-0.5 text-xs text-zinc-500">{periodLabel}</p>
        </div>
        <div className="flex gap-0.5 rounded-lg border border-zinc-700 bg-zinc-800 p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={`rounded-md px-3 py-1 text-xs capitalize transition-colors ${
                period === p ? "bg-zinc-700 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3">
        <Stat label="Days logged" value={String(stats.daysLogged)} />
        <Stat
          label="Miles"
          value={stats.miles.toLocaleString(undefined, { maximumFractionDigits: 1 })}
        />
        <Stat label="Minutes" value={String(stats.totalMinutes)} />
      </div>
    </section>
  );
}

export function Exercise() {
  const exercises = useQuery({ queryKey: ["exercises"], queryFn: getExercises });
  const rows = exercises.data?.exercises ?? [];
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ExerciseRow | null>(null);

  return (
    <>
      <ExerciseStats rows={rows} />

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
        {exercises.isPending && <p className="text-zinc-400">Loading…</p>}
        {exercises.isError && (
          <p className="text-red-400">Couldn't load exercises — {(exercises.error as Error).message}</p>
        )}
        {exercises.isSuccess && rows.length === 0 && (
          <p className="text-zinc-400">No workouts logged yet — add your first above.</p>
        )}

        {rows.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-xs uppercase tracking-wide text-zinc-500">
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Log</th>
                  <th className="px-4 py-3 text-right font-medium">Time</th>
                  <th className="px-4 py-3 text-right font-medium">Distance</th>
                  <th className="px-4 py-3 text-right font-medium">Calories</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-zinc-800/50 last:border-0">
                    <td className="whitespace-nowrap px-4 py-3 text-zinc-300">{prettyDate(r.date)}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs capitalize text-zinc-200">
                        {r.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-300">{r.description ?? "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-zinc-300">
                      {r.totalTime == null ? "—" : `${r.totalTime} min`}
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
                        onClick={() => setEditing(r)}
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
