import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SyncProcessStatus } from "@life/shared";
import { getStatusTimed, syncSource } from "../api";

// Last sync time for one process (lastRun), or "—" while running/never.
const fmtTime = (d: Date | string | null) =>
  d ? new Date(d).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

// Sources that expose an on-demand Sync button, mapped to the data query to
// refetch once the sync finishes (["status"] is always invalidated too).
const SYNC_BUTTON_QUERIES: Record<string, string> = {
  todoist: "todos",
  calendar: "calendar-events",
};

const STATUS_STYLE: Record<SyncProcessStatus, string> = {
  ok: "text-emerald-400",
  error: "text-red-400",
  running: "text-amber-400",
  idle: "text-zinc-500",
  off: "text-zinc-600",
};

// Circular-arrow refresh icon; spins while a sync is in flight.
export function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`h-3.5 w-3.5 ${spinning ? "animate-spin" : ""}`}
      aria-hidden="true"
    >
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

// Per-row Sync button. Triggers the connector, then refreshes the status widget
// and that source's data. DB-mutating, so it carries cursor-pointer.
function SyncButton({ source, label }: { source: string; label: string }) {
  const queryClient = useQueryClient();
  const sync = useMutation({
    mutationFn: () => syncSource(source),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["status"] });
      queryClient.invalidateQueries({ queryKey: [SYNC_BUTTON_QUERIES[source]] });
    },
  });
  return (
    <button
      type="button"
      onClick={() => sync.mutate()}
      disabled={sync.isPending}
      aria-label={`Sync ${label}`}
      title={`Sync ${label}`}
      className="flex cursor-pointer justify-end text-zinc-500 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <RefreshIcon spinning={sync.isPending} />
    </button>
  );
}

// Every automated process (connectors + the live Neon check), one row each, with
// its type, cadence, last-run time, and health. Self-contained (owns its query)
// so it can drop onto any page. Header shows how long the status read took (Neon
// can be slow on a cold start).
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
      {status.isSuccess && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-zinc-500">
                <th className="pb-2 pr-4 font-medium">Service</th>
                <th className="pb-2 pr-4 font-medium">Type</th>
                <th className="pb-2 pr-4 font-medium">Interval</th>
                <th className="pb-2 pr-4 font-medium">Last sync</th>
                <th className="pb-2 pr-4 font-medium">Status</th>
                <th className="pb-2 font-medium" aria-label="Sync" />
              </tr>
            </thead>
            <tbody>
              {status.data.processes.map((p) => (
                <tr key={p.key} className="border-t border-zinc-800/60">
                  <td className="py-2 pr-4 text-zinc-200">{p.label}</td>
                  <td className="whitespace-nowrap py-2 pr-4 text-zinc-400">{p.type}</td>
                  <td className="whitespace-nowrap py-2 pr-4 text-zinc-400">{p.cadence}</td>
                  <td className="whitespace-nowrap py-2 pr-4 text-xs text-zinc-500">
                    {fmtTime(p.lastRun)}
                  </td>
                  <td className={`py-2 pr-4 ${STATUS_STYLE[p.status]}`} title={p.error ?? undefined}>
                    {p.status}
                  </td>
                  <td className="w-6 py-2">
                    {p.key in SYNC_BUTTON_QUERIES && <SyncButton source={p.key} label={p.label} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
