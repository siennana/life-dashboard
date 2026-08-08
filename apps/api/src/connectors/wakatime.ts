import { eq } from "drizzle-orm";
import { metrics, syncRuns, type Db } from "@life/db";

// WakaTime coding time, read-only. Free accounts only expose ~14 days of
// detail through the API, so each sync re-pulls that trailing window into
// `metrics` (source "wakatime", name "coding_seconds", one row per day,
// last-write-wins - today's row climbs during the day) and the DB accumulates
// the history WakaTime's free tier forgets. Per-day language/project splits
// ride in the payload for the Projects page bars.

type SummaryDay = {
  range: { date: string };
  grand_total: { total_seconds: number };
  languages?: { name: string; total_seconds: number }[];
  projects?: { name: string; total_seconds: number }[];
};

// Trim a breakdown list to its top entries so the payload stays small.
const top = (list: { name: string; total_seconds: number }[] | undefined, n: number) =>
  (list ?? [])
    .filter((x) => x.total_seconds > 0)
    .sort((a, b) => b.total_seconds - a.total_seconds)
    .slice(0, n)
    .map((x) => ({ name: x.name, seconds: Math.round(x.total_seconds) }));

export async function syncWakatime(db: Db, apiKey: string) {
  const run = (await db.insert(syncRuns).values({ source: "wakatime" }).returning())[0]!;
  try {
    const end = new Date();
    const start = new Date(end.getTime() - 13 * 24 * 60 * 60 * 1000);
    const fmt = (d: Date) => d.toLocaleDateString("en-CA");
    const url = `https://api.wakatime.com/api/v1/users/current/summaries?start=${fmt(start)}&end=${fmt(end)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${Buffer.from(apiKey).toString("base64")}` },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`WakaTime summaries failed: ${res.status} ${detail.slice(0, 300)}`);
    }
    const body = (await res.json()) as { data?: SummaryDay[] };
    const days = body.data ?? [];
    if (days.length === 0) throw new Error("WakaTime returned no summary days");

    for (const d of days) {
      const value = String(Math.round(d.grand_total.total_seconds));
      const payload = { languages: top(d.languages, 8), projects: top(d.projects, 8) };
      await db
        .insert(metrics)
        .values({
          source: "wakatime",
          name: "coding_seconds",
          value,
          unit: "seconds",
          date: d.range.date,
          payload,
        })
        .onConflictDoUpdate({
          target: [metrics.source, metrics.name, metrics.date],
          set: { value, payload },
        });
    }

    await db
      .update(syncRuns)
      .set({ finishedAt: new Date(), status: "ok" })
      .where(eq(syncRuns.id, run.id));
    return { ok: true, days: days.length };
  } catch (err) {
    await db
      .update(syncRuns)
      .set({ finishedAt: new Date(), status: "error", error: String(err) })
      .where(eq(syncRuns.id, run.id));
    throw err;
  }
}
