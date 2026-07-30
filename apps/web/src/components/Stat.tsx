// A labeled value tile, used by the finance totals/risk cards and the exercise
// stats bar. `tone` overrides the value color (e.g. gain/loss green/red).
export function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${tone ?? "text-zinc-100"}`}>{value}</div>
    </div>
  );
}
