import { useQuery } from "@tanstack/react-query";
import { getStatusTimed } from "../api";

// Last sync time for one source (finished_at), or "—" while running/never.
const fmtTime = (d: Date | string | null) =>
  d ? new Date(d).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

// Latest sync run per source. Self-contained (owns its query) so it can drop
// onto any page. Header shows how long the status read took (Neon can be slow
// on a cold start); each row shows its last-sync time.
export function SyncStatus() {
  const status = useQuery({ queryKey: ["status"], queryFn: getStatusTimed });

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-400">Sync status</h2>
        {status.isSuccess && (
          <span className="text-xs text-zinc-500">read {status.data.loadMs} ms</span>
        )}
      </div>
      {status.isPending && <p className="mt-3 text-zinc-400">Connecting…</p>}
      {status.isError && (
        <p className="mt-3 text-red-400">Cannot reach API — {(status.error as Error).message}</p>
      )}
      {status.isSuccess && status.data.sources.length === 0 && (
        <p className="mt-3 text-zinc-400">API connected. No sources synced yet.</p>
      )}
      {status.isSuccess && status.data.sources.length > 0 && (
        <ul className="mt-3 space-y-2">
          {status.data.sources.map((s) => (
            <li key={s.source} className="flex items-center justify-between text-sm">
              <span className="capitalize">{s.source}</span>
              <span className="flex items-center gap-3">
                <span className="text-xs text-zinc-500">{fmtTime(s.finished_at)}</span>
                <span
                  className={`w-14 text-right ${
                    s.status === "error" ? "text-red-400" : "text-emerald-400"
                  }`}
                >
                  {s.status}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
