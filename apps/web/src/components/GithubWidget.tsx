import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getContributions } from "../api";
import { Heatmap } from "./Heatmap";

// Home widget: the GitHub contribution graph (profile heatmap) rendered from
// the synced per-day counts. First consumer of the generic Heatmap.
export function GithubWidget() {
  const contributions = useQuery({
    queryKey: ["github-contributions"],
    queryFn: getContributions,
  });
  const total = (contributions.data?.days ?? []).reduce((a, d) => a + d.count, 0);

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-400">GitHub</h2>
        <div className="flex items-baseline gap-3">
          {contributions.data && contributions.data.days.length > 0 && (
            <span className="text-xs text-zinc-500">
              {total.toLocaleString()} contributions in the last year
            </span>
          )}
          <Link to="/projects" className="text-xs text-zinc-500 hover:text-zinc-300">
            Projects →
          </Link>
        </div>
      </div>

      {contributions.isPending && <p className="mt-3 text-zinc-400">Loading…</p>}
      {contributions.isError && (
        <p className="mt-3 text-red-400">
          Couldn't load contributions — {(contributions.error as Error).message}
        </p>
      )}
      {contributions.data && !contributions.data.configured && (
        <p className="mt-3 text-sm text-zinc-400">
          Set <code>GITHUB_TOKEN</code> in <code>.env</code> to show your commit graph.
        </p>
      )}
      {contributions.data && contributions.data.configured && contributions.data.days.length === 0 && (
        <p className="mt-3 text-sm text-zinc-400">
          No contribution data yet — the first sync runs on API boot, then every 5 minutes.
        </p>
      )}
      {contributions.data && contributions.data.days.length > 0 && (
        <Heatmap
          days={contributions.data.days.map((d) => ({ date: d.date, value: d.count }))}
          formatValue={(v) => `${v} contribution${v === 1 ? "" : "s"}`}
        />
      )}
    </section>
  );
}
