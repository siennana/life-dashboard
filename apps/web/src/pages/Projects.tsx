import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { GithubCommit } from "@life/shared";
import { getContributions, getGithubCommits, getGithubRepos } from "../api";
import { Heatmap } from "../components/Heatmap";
import { ACCENT } from "../lib/finance";

// Projects: the expanded GitHub view. Same generic Heatmap as Home but
// selectable — clicking a day shows that day's commits (with GitHub links) —
// plus per-repo commit counts for the past year. Private repos the read:user
// token can't read are counted in the heatmap but absent from repo/commit
// detail (see connectors/github.ts).

const localDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA");

const headerDate = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

const commitTime = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

// Single measure (commits per repo) -> single accent hue, SectorBars form.
function RepoBars() {
  const repos = useQuery({ queryKey: ["github-repos"], queryFn: getGithubRepos });
  const list = repos.data?.repos ?? [];
  const max = Math.max(...list.map((r) => r.commitsPastYear), 1);

  return (
    // Fixed card height shared with the day-commits panel; the list scrolls
    // inside (min-h-0 so the flex child can actually shrink).
    <section className="flex h-80 flex-col rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <div className="flex shrink-0 items-baseline justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-400">
          Commits by repo
        </h2>
        <span className="text-xs text-zinc-500">past year</span>
      </div>
      {repos.isPending && <p className="mt-3 text-zinc-400">Loading…</p>}
      {repos.isError && (
        <p className="mt-3 text-red-400">
          Couldn't load repos — {(repos.error as Error).message}
        </p>
      )}
      <ul className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto">
        {list.map((r) => (
          <li key={r.name} className="flex items-center gap-3 text-sm">
            <a
              href={r.url}
              target="_blank"
              rel="noreferrer"
              className="w-44 shrink-0 truncate text-zinc-300 hover:text-zinc-100"
              title={r.name}
            >
              {r.name.split("/")[1] ?? r.name}
            </a>
            <span className="relative h-3.5 min-w-0 flex-1">
              <span
                className="absolute inset-y-0 left-0 rounded-r-[4px]"
                style={{ width: `${(r.commitsPastYear / max) * 100}%`, background: ACCENT }}
              />
            </span>
            <span className="w-12 shrink-0 text-right tabular-nums text-zinc-100">
              {r.commitsPastYear}
            </span>
          </li>
        ))}
        {repos.isSuccess && list.length === 0 && (
          <li className="text-sm text-zinc-500">No repos synced yet.</li>
        )}
      </ul>
    </section>
  );
}

function DayCommits({ date, commits }: { date: string; commits: GithubCommit[] }) {
  return (
    // Same fixed height as the repo card; the commit list scrolls inside.
    <section className="flex h-80 flex-col rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <div className="flex shrink-0 items-baseline justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-400">
          {headerDate(date)}
        </h2>
        <span className="text-xs text-zinc-500">
          {commits.length} commit{commits.length === 1 ? "" : "s"}
        </span>
      </div>
      {commits.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">
          No synced commits this day — contributions can also be PRs, reviews, issues, or commits
          in repos this token can't read.
        </p>
      ) : (
        <ul className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto">
          {commits.map((c) => (
            <li key={c.sha} className="flex items-baseline gap-3 text-sm">
              <span className="w-14 shrink-0 text-xs tabular-nums text-zinc-500">
                {commitTime(c.ts)}
              </span>
              <div className="min-w-0 flex-1">
                <a
                  href={c.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-zinc-200 hover:text-zinc-100"
                  title={c.message}
                >
                  {c.message}
                </a>
                <div className="truncate text-xs text-zinc-500">
                  {c.repo.split("/")[1] ?? c.repo}
                  <span className="ml-2 font-mono">{c.sha.slice(0, 7)}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Projects() {
  const contributions = useQuery({
    queryKey: ["github-contributions"],
    queryFn: getContributions,
  });
  const commits = useQuery({ queryKey: ["github-commits"], queryFn: getGithubCommits });
  const [selected, setSelected] = useState<string>(() => new Date().toLocaleDateString("en-CA"));

  const days = contributions.data?.days ?? [];
  const total = days.reduce((a, d) => a + d.count, 0);
  const dayCommits = (commits.data?.commits ?? []).filter((c) => localDay(c.ts) === selected);

  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-semibold">Projects</h1>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-400">GitHub</h2>
          {days.length > 0 && (
            <span className="text-xs text-zinc-500">
              {total.toLocaleString()} contributions in the last year · click a day for its commits
            </span>
          )}
        </div>
        {contributions.isPending && <p className="mt-3 text-zinc-400">Loading…</p>}
        {contributions.isError && (
          <p className="mt-3 text-red-400">
            Couldn't load contributions — {(contributions.error as Error).message}
          </p>
        )}
        {contributions.data && !contributions.data.configured && (
          <p className="mt-3 text-sm text-zinc-400">
            Set <code>GITHUB_TOKEN</code> in <code>.env</code> to sync your GitHub activity.
          </p>
        )}
        {days.length > 0 && (
          <Heatmap
            days={days.map((d) => ({ date: d.date, value: d.count }))}
            formatValue={(v) => `${v} contribution${v === 1 ? "" : "s"}`}
            selectedDate={selected}
            onSelectDay={setSelected}
          />
        )}
      </section>

      <div className="grid gap-3 lg:grid-cols-2">
        <DayCommits date={selected} commits={dayCommits} />
        <RepoBars />
      </div>
    </div>
  );
}
