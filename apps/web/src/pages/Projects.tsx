import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { GithubCommit, WakatimeSlice } from "@life/shared";
import { getContributions, getGithubCommits, getGithubRepos, getWakatime } from "../api";
import { Heatmap } from "../components/Heatmap";
import { ACCENT, INK_MUTED, TipBox, type Tip } from "../lib/finance";

// Seconds -> "3h 24m" / "24m" (coding durations).
function fmtDuration(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

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

// 7-day breakdown bars (languages or projects) — single measure, one accent.
function WakaBars({ title, slices }: { title: string; slices: WakatimeSlice[] }) {
  const max = Math.max(...slices.map((s) => s.seconds), 1);
  return (
    <div>
      <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">{title}</h3>
      <ul className="mt-2 space-y-2">
        {slices.map((s) => (
          <li key={s.name} className="flex items-center gap-3 text-sm">
            <span className="w-28 shrink-0 truncate text-zinc-300" title={s.name}>
              {s.name}
            </span>
            <span className="relative h-3.5 min-w-0 flex-1">
              <span
                className="absolute inset-y-0 left-0 rounded-r-[4px]"
                style={{ width: `${(s.seconds / max) * 100}%`, background: ACCENT }}
              />
            </span>
            <span className="w-16 shrink-0 text-right tabular-nums text-zinc-100">
              {fmtDuration(s.seconds)}
            </span>
          </li>
        ))}
        {slices.length === 0 && <li className="text-sm text-zinc-500">Nothing in the last 7 days.</li>}
      </ul>
    </div>
  );
}

// Daily coding-time columns for the trailing two weeks — a year heatmap was
// mostly empty cells while the series is young (WakaTime free only feeds 14
// days at a time; our DB accumulates them). Swap back to <Heatmap> once
// enough history exists to be worth a year view. Zero days get a 2px stub so
// "tracked, nothing coded" stays visible.
function CodingBars({ days }: { days: { date: string; seconds: number }[] }) {
  const [tip, setTip] = useState<Tip>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const W = 640;
  const H = 130;
  const PAD_T = 8;
  const PAD_B = 16;
  const plotH = H - PAD_T - PAD_B;
  // Floor the scale at 1h so a lone 5-minute day doesn't render as a skyline.
  const max = Math.max(...days.map((d) => d.seconds), 3600);
  const slot = W / days.length;
  const barW = Math.min(slot - 4, 34);

  const dow = (date: string) =>
    new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "narrow" });

  function showTip(e: React.PointerEvent, d: { date: string; seconds: number }) {
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTip({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      lines: [
        fmtDuration(d.seconds),
        new Date(`${d.date}T12:00:00`).toLocaleDateString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
        }),
      ],
    });
  }

  return (
    <div ref={boxRef} className="relative">
      <TipBox tip={tip} />
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 w-full" role="img" aria-label="Daily coding time">
        {days.map((d, i) => {
          const h = d.seconds > 0 ? Math.max((d.seconds / max) * plotH, 3) : 2;
          const x = i * slot + (slot - barW) / 2;
          return (
            <g key={d.date}>
              <rect
                x={x}
                y={PAD_T + plotH - h}
                width={barW}
                height={h}
                rx={3}
                fill={d.seconds > 0 ? ACCENT : "#3f3f46"}
                onPointerMove={(e) => showTip(e, d)}
                onPointerLeave={() => setTip(null)}
              />
              <text
                x={i * slot + slot / 2}
                y={H - 4}
                textAnchor="middle"
                fontSize={9}
                fill={INK_MUTED}
              >
                {dow(d.date)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// Coding time from WakaTime: daily columns for the last two weeks (the DB
// keeps what the free API window forgets) + 7-day language/project bars.
function WakatimeCard() {
  const waka = useQuery({ queryKey: ["wakatime"], queryFn: getWakatime });
  const d = waka.data;

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-400">Coding time</h2>
        {d && d.days.length > 0 && (
          <span className="text-xs text-zinc-500">
            {d.todaySeconds != null ? `today ${fmtDuration(d.todaySeconds)} · ` : ""}
            last 7 days {fmtDuration(d.weekSeconds)}
          </span>
        )}
      </div>
      {waka.isPending && <p className="mt-3 text-zinc-400">Loading…</p>}
      {waka.isError && (
        <p className="mt-3 text-red-400">
          Couldn't load WakaTime — {(waka.error as Error).message}
        </p>
      )}
      {d && !d.configured && (
        <p className="mt-3 text-sm text-zinc-400">
          Set <code>WAKATIME_API_KEY</code> in <code>.env</code> to track coding time.
        </p>
      )}
      {d && d.configured && d.days.length === 0 && (
        <p className="mt-3 text-sm text-zinc-400">
          No coding time synced yet — the first sync runs on API boot, then every 5 minutes.
        </p>
      )}
      {d && d.days.length > 0 && (
        <>
          <CodingBars days={d.days.slice(-14)} />
          <div className="mt-4 grid gap-6 border-t border-zinc-800 pt-4 sm:grid-cols-2">
            <WakaBars title="Languages · 7 days" slices={d.languages} />
            <WakaBars title="Projects · 7 days" slices={d.projects} />
          </div>
        </>
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

      <WakatimeCard />
    </div>
  );
}
