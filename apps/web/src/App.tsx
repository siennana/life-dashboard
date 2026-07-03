import { useQuery } from "@tanstack/react-query";
import { getStatus } from "./api";

export default function App() {
  const status = useQuery({ queryKey: ["status"], queryFn: getStatus });

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-semibold">Life Dashboard</h1>
        <p className="mt-1 text-sm text-zinc-400">
          {new Date().toLocaleDateString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </p>

        <section className="mt-8 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-400">
            Sync status
          </h2>
          {status.isPending && <p className="mt-3 text-zinc-400">Connecting…</p>}
          {status.isError && (
            <p className="mt-3 text-red-400">
              Cannot reach API — {(status.error as Error).message}
            </p>
          )}
          {status.isSuccess && status.data.sources.length === 0 && (
            <p className="mt-3 text-zinc-400">
              API connected. No sources synced yet — Phase 1 adds Todoist.
            </p>
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
      </main>
    </div>
  );
}
