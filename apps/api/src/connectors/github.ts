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
// Token: classic PAT with read:user. That sees counts for everything but
// commit/repo detail only for PUBLIC repos - private repos are folded into
// the calendar counts by GitHub and simply don't appear in the repo list.
// Detail reads the default branch only, so feature-branch commits join the
// list when merged.

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

    // 2. Per-repo year counts -> events (type "repo"), replace semantics.
    const byRepo = collection?.commitContributionsByRepository ?? [];
    const now = new Date();
    for (const r of byRepo) {
      const payload = {
        url: r.repository.url,
        isPrivate: r.repository.isPrivate,
        commitsPastYear: r.contributions.totalCount,
      };
      await db
        .insert(events)
        .values({
          source: "github",
          externalId: r.repository.nameWithOwner,
          type: "repo",
          title: r.repository.nameWithOwner,
          startTs: now,
          payload,
        })
        .onConflictDoUpdate({
          target: [events.source, events.externalId],
          set: { startTs: now, payload, updatedAt: now },
        });
    }
    const repoIds = byRepo.map((r) => r.repository.nameWithOwner);
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

    // 3. Commit detail per repo -> events (type "commit"). Per-repo failures
    // degrade to "no detail for that repo", never fail the run.
    let commitCount = 0;
    for (const r of byRepo) {
      let commits: Awaited<ReturnType<typeof fetchRepoCommits>>;
      try {
        commits = await fetchRepoCommits(
          token,
          r.repository.owner.login,
          r.repository.name,
          from.toISOString(),
          viewerId,
        );
      } catch {
        continue;
      }
      for (const c of commits) {
        const payload = { repo: r.repository.nameWithOwner, url: c.url };
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
    return { ok: true, days: days.length, repos: byRepo.length, commits: commitCount };
  } catch (err) {
    await db
      .update(syncRuns)
      .set({ finishedAt: new Date(), status: "error", error: String(err) })
      .where(eq(syncRuns.id, run.id));
    throw err;
  }
}
