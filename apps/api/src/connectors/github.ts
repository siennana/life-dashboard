import { and, eq, notInArray } from "drizzle-orm";
import { events, metrics, syncRuns, type Db } from "@life/db";

// GitHub activity, read-only, via GraphQL. Three things per sync, all inside
// the trailing 365 days (the API caps one contributionsCollection window at a
// year):
//   1. contribution calendar -> `metrics` (source "github", name
//      "contributions", one row per day, zeros stored) - drives the heatmaps.
//   2. per-repo commit counts -> `events` (type "repo", externalId =
//      owner/name) - the Projects page's repo list.
//   3. actual commits (message + URL) per accessible repo -> `events` (type
//      "commit", externalId = sha) - the Projects page's day-click detail.
// Token: fine-grained PAT, Contents read-only on all owned repos. Calendar
// counts include everything; repo/commit detail covers public repos plus the
// viewer's own private repos (via the pushed-repo sweep below - GitHub's
// GraphQL treats fine-grained PATs' private contributions as "restricted" in
// commitContributionsByRepository even when the token can read the repo, so
// that breakdown alone would miss them). Private repos owned by someone else
// stay calendar-only. Detail reads the default branch only, so feature-branch
// commits join the list when merged.

const OVERVIEW_QUERY = `
query($from: DateTime!, $to: DateTime!) {
  viewer {
    id
    contributionsCollection(from: $from, to: $to) {
      contributionCalendar {
        weeks { contributionDays { date contributionCount } }
      }
      commitContributionsByRepository(maxRepositories: 25) {
        repository { nameWithOwner url isPrivate owner { login } name }
        contributions { totalCount }
      }
    }
  }
}`;

// The viewer's own repos, newest push first. One page of 50 covers repos with
// activity inside the year window - anything older is filtered out anyway.
const REPOS_QUERY = `
query {
  viewer {
    repositories(first: 50, affiliations: [OWNER], orderBy: { field: PUSHED_AT, direction: DESC }) {
      nodes { nameWithOwner url isPrivate pushedAt owner { login } name }
    }
  }
}`;

// Commit history on the default branch, filtered to the viewer as author.
const HISTORY_QUERY = `
query($owner: String!, $name: String!, $since: GitTimestamp!, $authorId: ID!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    defaultBranchRef {
      target {
        ... on Commit {
          history(since: $since, author: { id: $authorId }, first: 100, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes { oid messageHeadline committedDate url }
          }
        }
      }
    }
  }
}`;

type OverviewResponse = {
  data?: {
    viewer?: {
      id: string;
      contributionsCollection?: {
        contributionCalendar?: {
          weeks: { contributionDays: { date: string; contributionCount: number }[] }[];
        };
        commitContributionsByRepository?: {
          repository: {
            nameWithOwner: string;
            url: string;
            isPrivate: boolean;
            owner: { login: string };
            name: string;
          };
          contributions: { totalCount: number };
        }[];
      };
    };
  };
  errors?: { message?: string }[];
};

type RepoRef = {
  nameWithOwner: string;
  url: string;
  isPrivate: boolean;
  owner: { login: string };
  name: string;
};

type ReposResponse = {
  data?: {
    viewer?: {
      repositories?: { nodes: (RepoRef & { pushedAt: string })[] };
    };
  };
};

type HistoryResponse = {
  data?: {
    repository?: {
      defaultBranchRef?: {
        target?: {
          history?: {
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
            nodes: { oid: string; messageHeadline: string; committedDate: string; url: string }[];
          };
        };
      };
    };
  };
  errors?: { message?: string }[];
};

async function gql<T>(token: string, query: string, variables: object): Promise<T> {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "life-dashboard",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`GitHub GraphQL failed: ${res.status} ${detail.slice(0, 300)}`);
  }
  const body = (await res.json()) as T & { errors?: { message?: string }[] };
  if (body.errors?.length) {
    throw new Error(`GitHub GraphQL error: ${body.errors[0]?.message ?? "unknown"}`);
  }
  return body;
}

// All commits authored by the viewer on the repo's default branch since
// `since`. A repo the token can't read (or an empty repo) yields [] - one bad
// repo must never fail the sync.
async function fetchRepoCommits(
  token: string,
  owner: string,
  name: string,
  since: string,
  authorId: string,
) {
  const commits: { oid: string; messageHeadline: string; committedDate: string; url: string }[] = [];
  let cursor: string | null = null;
  // Page cap keeps one misbehaving repo from eating the sync (500 commits/repo).
  for (let page = 0; page < 5; page++) {
    const body: HistoryResponse = await gql<HistoryResponse>(token, HISTORY_QUERY, {
      owner,
      name,
      since,
      authorId,
      cursor,
    });
    const history = body.data?.repository?.defaultBranchRef?.target?.history;
    if (!history) break;
    commits.push(...history.nodes);
    if (!history.pageInfo.hasNextPage) break;
    cursor = history.pageInfo.endCursor;
  }
  return commits;
}

export async function syncGithub(db: Db, token: string) {
  const run = (await db.insert(syncRuns).values({ source: "github" }).returning())[0]!;
  try {
    const to = new Date();
    const from = new Date(to.getTime() - 364 * 24 * 60 * 60 * 1000);
    const overview = await gql<OverviewResponse>(token, OVERVIEW_QUERY, {
      from: from.toISOString(),
      to: to.toISOString(),
    });
    const viewerId = overview.data?.viewer?.id;
    const collection = overview.data?.viewer?.contributionsCollection;
    const weeks = collection?.contributionCalendar?.weeks ?? [];
    const days = weeks.flatMap((w) => w.contributionDays);
    if (!viewerId || days.length === 0) throw new Error("GitHub returned no contribution data");

    // 1. Calendar counts -> metrics. Zeros stored: a 0 row means "synced,
    // nothing that day", which renders as an empty cell rather than a gap.
    for (const d of days) {
      const value = String(d.contributionCount);
      await db
        .insert(metrics)
        .values({ source: "github", name: "contributions", value, unit: "count", date: d.date })
        .onConflictDoUpdate({
          target: [metrics.source, metrics.name, metrics.date],
          set: { value },
        });
    }

    // 2. Contributing repos. commitContributionsByRepository is the primary
    // source, but it omits the viewer's private repos on a fine-grained PAT
    // (their contributions land in restrictedContributionsCount instead, even
    // with Contents read on the repo) - so also sweep recently pushed owned
    // repos; any with authored default-branch commits in the window counts.
    const contributing = new Map<string, { repo: RepoRef; commitsPastYear: number | null }>();
    for (const r of collection?.commitContributionsByRepository ?? []) {
      contributing.set(r.repository.nameWithOwner, {
        repo: r.repository,
        commitsPastYear: r.contributions.totalCount,
      });
    }
    const pushed = await gql<ReposResponse>(token, REPOS_QUERY, {});
    for (const r of pushed.data?.viewer?.repositories?.nodes ?? []) {
      if (contributing.has(r.nameWithOwner) || new Date(r.pushedAt) < from) continue;
      contributing.set(r.nameWithOwner, { repo: r, commitsPastYear: null });
    }

    // 3. Commit detail per repo, fetched before the repo rows are written so
    // swept repos get a real count - and drop out when the viewer authored
    // nothing on the default branch in the window. Per-repo failures degrade
    // to "no detail for that repo", never fail the run.
    const commitsByRepo = new Map<string, Awaited<ReturnType<typeof fetchRepoCommits>>>();
    for (const [id, info] of contributing) {
      try {
        commitsByRepo.set(
          id,
          await fetchRepoCommits(token, info.repo.owner.login, info.repo.name, from.toISOString(), viewerId),
        );
      } catch {
        commitsByRepo.set(id, []);
      }
    }
    for (const [id, info] of contributing) {
      if (info.commitsPastYear === null && (commitsByRepo.get(id)?.length ?? 0) === 0) {
        contributing.delete(id);
      }
    }

    // Repo year counts -> events (type "repo"), replace semantics.
    const now = new Date();
    for (const { repo, commitsPastYear } of contributing.values()) {
      const payload = {
        url: repo.url,
        isPrivate: repo.isPrivate,
        commitsPastYear: commitsPastYear ?? commitsByRepo.get(repo.nameWithOwner)?.length ?? 0,
      };
      await db
        .insert(events)
        .values({
          source: "github",
          externalId: repo.nameWithOwner,
          type: "repo",
          title: repo.nameWithOwner,
          startTs: now,
          payload,
        })
        .onConflictDoUpdate({
          target: [events.source, events.externalId],
          set: { startTs: now, payload, updatedAt: now },
        });
    }
    const repoIds = [...contributing.keys()];
    if (repoIds.length > 0) {
      await db
        .delete(events)
        .where(
          and(
            eq(events.source, "github"),
            eq(events.type, "repo"),
            notInArray(events.externalId, repoIds),
          ),
        );
    }

    // Commits -> events (type "commit").
    let commitCount = 0;
    for (const [id, commits] of commitsByRepo) {
      if (!contributing.has(id)) continue;
      for (const c of commits) {
        const payload = { repo: id, url: c.url };
        await db
          .insert(events)
          .values({
            source: "github",
            externalId: c.oid,
            type: "commit",
            title: c.messageHeadline,
            startTs: new Date(c.committedDate),
            payload,
          })
          .onConflictDoUpdate({
            target: [events.source, events.externalId],
            set: { title: c.messageHeadline, payload, updatedAt: new Date() },
          });
      }
      commitCount += commits.length;
    }

    await db
      .update(syncRuns)
      .set({ finishedAt: new Date(), status: "ok" })
      .where(eq(syncRuns.id, run.id));
    return { ok: true, days: days.length, repos: contributing.size, commits: commitCount };
  } catch (err) {
    await db
      .update(syncRuns)
      .set({ finishedAt: new Date(), status: "error", error: String(err) })
      .where(eq(syncRuns.id, run.id));
    throw err;
  }
}
