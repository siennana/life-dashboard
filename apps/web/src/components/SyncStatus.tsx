import { useQuery } from "@tanstack/react-query";
import { getStatus } from "../api";

// sync_runs stores the connector's internal source key, which doesn't always
// match what should show on screen (the calendar connector is iCloud CalDAV).
const SOURCE_LABELS: Record<string, string> = {
  calendar: "CalDAV",
};

function labelFor(source: string) {
  return SOURCE_LABELS[source] ?? source.charAt(0).toUpperCase() + source.slice(1);
}

// Latest sync run per source, plus a live Neon connectivity check. Self-contained
// (owns its query) so it can drop onto any page.
export function SyncStatus() {
  const status = useQuery({ queryKey: ["status"], queryFn: getStatus });

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-400">Sync status</h2>
      {status.isPending && <p className="mt-3 text-zinc-400">Connecting…</p>}
      {status.isError && (
        <p className="mt-3 text-red-400">Cannot reach API — {(status.error as Error).message}</p>
      )}
      {status.isSuccess && (
        <ul className="mt-3 space-y-2">
          <li className="flex items-center justify-between text-sm">
            <span>Neon</span>
            <span
              className={status.data.database.status === "error" ? "text-red-400" : "text-emerald-400"}
            >
              {status.data.database.status}
            </span>
          </li>
          {status.data.sources.length === 0 && (
            <li className="text-zinc-400">No connectors synced yet.</li>
          )}
          {status.data.sources.map((s) => (
            <li key={s.source} className="flex items-center justify-between text-sm">
              <span>{labelFor(s.source)}</span>
              <span className={s.status === "error" ? "text-red-400" : "text-emerald-400"}>
                {s.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
