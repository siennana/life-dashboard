import { useQuery } from "@tanstack/react-query";
import { getStatus } from "../api";

// Latest sync run per source. Self-contained (owns its query) so it can drop
// onto any page.
export function SyncStatus() {
  const status = useQuery({ queryKey: ["status"], queryFn: getStatus });

  return (
    <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-400">Sync status</h2>
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
