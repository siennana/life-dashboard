import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getStatusTimed, syncSource } from "../api";

// Last sync time for one source (finished_at), or "—" while running/never.
const fmtTime = (d: Date | string | null) =>
  d ? new Date(d).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

// sync_runs stores the connector's internal source key, which doesn't always
// match what should show on screen (the calendar connector is iCloud CalDAV).
const SOURCE_LABELS: Record<string, string> = {
  calendar: "CalDAV",
};

// Sources that expose an on-demand Sync button, mapped to the data query to
// refetch once the sync finishes (["status"] is always invalidated too).
const SYNC_BUTTON_QUERIES: Record<string, string> = {
  todoist: "todos",
  calendar: "calendar-events",
};

function labelFor(source: string) {
  return SOURCE_LABELS[source] ?? source.charAt(0).toUpperCase() + source.slice(1);
}

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
function SyncButton({ source }: { source: string }) {
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
      aria-label={`Sync ${labelFor(source)}`}
      title={`Sync ${labelFor(source)}`}
      className="flex w-14 cursor-pointer justify-end text-zinc-500 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <RefreshIcon spinning={sync.isPending} />
    </button>
  );
}

// Latest sync run per source, plus a live Neon connectivity check. Self-contained
// (owns its query) so it can drop onto any page. Header shows how long the status
// read took (Neon can be slow on a cold start); each row shows its last-sync time.
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
        <ul className="mt-3 space-y-2">
          <li className="flex items-center justify-between text-sm">
            <span>Neon</span>
            <span className="flex items-center gap-3">
              <span className="text-xs text-zinc-500">{fmtTime(status.data.database.checkedAt)}</span>
              <span
                className={`w-14 text-right ${
                  status.data.database.status === "error" ? "text-red-400" : "text-emerald-400"
                }`}
              >
                {status.data.database.status}
              </span>
              <span className="w-14" />
            </span>
          </li>
          {status.data.sources.length === 0 && (
            <li className="text-zinc-400">No connectors synced yet.</li>
          )}
          {status.data.sources.map((s) => (
            <li key={s.source} className="flex items-center justify-between text-sm">
              <span>{labelFor(s.source)}</span>
              <span className="flex items-center gap-3">
                <span className="text-xs text-zinc-500">{fmtTime(s.finished_at)}</span>
                <span
                  className={`w-14 text-right ${
                    s.status === "error" ? "text-red-400" : "text-emerald-400"
                  }`}
                >
                  {s.status}
                </span>
                {s.source in SYNC_BUTTON_QUERIES ? (
                  <SyncButton source={s.source} />
                ) : (
                  <span className="w-14" />
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
