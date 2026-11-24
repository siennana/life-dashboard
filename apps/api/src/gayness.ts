import { and, eq, gte, lte, sql } from "drizzle-orm";
import { calendarDays, events, metrics, tagRules, tags, type Db } from "@life/db";
import { GAYNESS_LABELS, type GaynessDay, type GaynessResponse } from "@life/shared";
import { loadTxs, merchantKeyOf } from "./spending";

// The gayness monitor: every day rates 1-5 (gay ... SUPER MEGA GAY) from
// signals the dashboard already collects. The floor is 1 - no day is not gay.
// Scores are computed per request, never stored, so reweighting a rule
// retroactively re-scores all history.
//
// Design notes, grounded in the actual data:
// - The dense daily signals are transactions, calendar events, and the GitHub
//   contributions series (zeros stored); manual signals (logs, exercise) are
//   sparse boosts. Absence of evidence is evidence of gayness: a day with no
//   productivity and no going-out charges scores "super gay" with zero effort.
// - The day job leaves no data trail, so workdays rate on their off-hours
//   signals alone. Canon.
// - Tag-driven levers need no code: merchants tagged "gay" add a point on any
//   day they charge; the student-loan tag's merchants subtract one.

export type DaySignals = {
  // Any TRANSPORTATION charge = left the house; its absence is the homebody point.
  transportation: boolean;
  // GitHub contributions + todos completed + (coded at all ? 1 : 0).
  productivityUnits: number;
  streaming: boolean; // streaming-service charge (the Sex and the City clause)
  delivery: boolean; // food delivery charge (couch economy)
  socialEvent: boolean; // calendar event matching a going-out keyword
  journaled: boolean; // non-blank day log
  exercised: boolean;
  finishedBook: boolean;
  gayMerchant: boolean; // charge from a merchant carrying the "gay" tag
  loanPayment: boolean; // student-loan payment; nothing gay about those
};

const STREAMING_MERCHANTS = [
  "prime video",
  "netflix",
  "hulu",
  "hbo",
  "max.com",
  "disney",
  "spotify",
  "paramount",
  "peacock",
  "crunchyroll",
];

// Word-bounded so "date" doesn't fire on "update" or "show" on "shower".
const SOCIAL_EVENT_RE =
  /\b(dinner|brunch|drag|pride|party|date|show|concert|wedding|movie|happy hour|karaoke)\b/i;

// Food-delivery merchant keys beyond whatever carries the "doordash" tag.
const DELIVERY_KEYS = new Set(["doordash", "grubhub", "uber eats", "postmates"]);

// Tolerant tag-name match (same approach as the loans page's student-loan
// lookup): strip non-letters and a plural s, so "Student Loans" still hits.
const normalizeTagName = (name: string) =>
  name.trim().toLowerCase().replace(/[^a-z]/g, "").replace(/s$/, "");

export function scoreGayDay(s: DaySignals): Pick<GaynessDay, "score" | "label" | "breakdown"> {
  const breakdown: { rule: string; points: number }[] = [];
  if (!s.transportation) breakdown.push({ rule: "homebody", points: 1 });
  if (s.productivityUnits === 0) breakdown.push({ rule: "zero productivity", points: 1 });
  else if (s.productivityUnits >= 3) breakdown.push({ rule: "heavy productivity", points: -1 });
  if (s.streaming) breakdown.push({ rule: "streaming", points: 1 });
  if (s.delivery) breakdown.push({ rule: "delivery", points: 1 });
  if (s.socialEvent) breakdown.push({ rule: "social event", points: 1 });
  if (s.journaled) breakdown.push({ rule: "journaled", points: 1 });
  if (s.exercised) breakdown.push({ rule: "exercise", points: 1 });
  if (s.finishedBook) breakdown.push({ rule: "finished a book", points: 1 });
  if (s.gayMerchant) breakdown.push({ rule: "gay-tagged merchant", points: 1 });
  if (s.loanPayment) breakdown.push({ rule: "student loan payment", points: -1 });
  const raw = 1 + breakdown.reduce((n, b) => n + b.points, 0);
  const score = Math.min(5, Math.max(1, raw));
  return { score, label: GAYNESS_LABELS[score - 1], breakdown };
}

const DAY_MS = 86_400_000;
const dayOf = (ts: Date) => ts.toISOString().slice(0, 10);

// Scores for every day in [from..to], clipped to today - future days have no
// data and would all rate "super gay by default", which is aspirational but
// not a measurement.
export async function buildGaynessScores(
  db: Db,
  from: string,
  to: string,
  today: string,
): Promise<GaynessResponse> {
  const end = to < today ? to : today;
  if (from > end) return { days: [] };
  const fromTs = new Date(`${from}T00:00:00.000Z`);
  const endTs = new Date(`${end}T23:59:59.999Z`);

  const [txs, contribRows, codingRows, todoRows, calRows, logRows, exerciseRows, bookRows, tagRows, ruleRows] =
    await Promise.all([
      loadTxs(db),
      db
        .select({ date: metrics.date, value: metrics.value })
        .from(metrics)
        .where(
          and(
            eq(metrics.source, "github"),
            eq(metrics.name, "contributions"),
            gte(metrics.date, from),
            lte(metrics.date, end),
          ),
        ),
      db
        .select({ date: metrics.date, value: metrics.value })
        .from(metrics)
        .where(
          and(
            eq(metrics.source, "wakatime"),
            eq(metrics.name, "coding_seconds"),
            gte(metrics.date, from),
            lte(metrics.date, end),
          ),
        ),
      db
        .select({ startTs: events.startTs, payload: events.payload })
        .from(events)
        .where(and(eq(events.source, "todoist"), eq(events.type, "todo"))),
      db
        .select({ startTs: events.startTs, title: events.title })
        .from(events)
        .where(
          and(
            eq(events.source, "calendar"),
            eq(events.type, "calendar-event"),
            gte(events.startTs, fromTs),
            lte(events.startTs, endTs),
          ),
        ),
      db
        .select({ date: calendarDays.date })
        .from(calendarDays)
        .where(sql`${calendarDays.log} is not null and btrim(${calendarDays.log}) <> ''`),
      db
        .select({ startTs: events.startTs })
        .from(events)
        .where(and(eq(events.source, "manual"), eq(events.type, "exercise"))),
      db
        .select({ payload: events.payload })
        .from(events)
        .where(and(eq(events.source, "manual"), eq(events.type, "book"))),
      db.select().from(tags),
      db.select().from(tagRules),
    ]);

  // Merchant-key sets per special tag. Missing tags just never fire.
  const keysForTag = (wanted: string) => {
    const ids = new Set(tagRows.filter((t) => normalizeTagName(t.name) === wanted).map((t) => t.id));
    return new Set(ruleRows.filter((r) => ids.has(r.tagId)).map((r) => r.merchantKey));
  };
  const gayKeys = keysForTag("gay");
  const loanKeys = keysForTag("studentloan");
  const deliveryKeys = new Set([...DELIVERY_KEYS, ...keysForTag("doordash")]);

  const chargesByDay = new Map<string, { key: string; name: string; category: string | null }[]>();
  for (const t of txs) {
    if (t.amount <= 0 || t.date < from || t.date > end) continue;
    const list = chargesByDay.get(t.date) ?? [];
    list.push({ key: merchantKeyOf(t.name), name: t.name.toLowerCase(), category: t.category });
    chargesByDay.set(t.date, list);
  }

  const contribByDay = new Map(contribRows.map((r) => [r.date, Number(r.value)]));
  const codingByDay = new Map(codingRows.map((r) => [r.date, Number(r.value)]));

  const todosByDay = new Map<string, number>();
  for (const r of todoRows) {
    if (((r.payload ?? {}) as { status?: string }).status !== "completed") continue;
    const d = dayOf(r.startTs);
    todosByDay.set(d, (todosByDay.get(d) ?? 0) + 1);
  }

  const socialDays = new Set<string>();
  for (const r of calRows) {
    if (r.title && SOCIAL_EVENT_RE.test(r.title)) socialDays.add(dayOf(r.startTs));
  }

  const logDays = new Set(logRows.map((r) => r.date));
  const exerciseDays = new Set(exerciseRows.map((r) => dayOf(r.startTs)));
  const bookDays = new Set(
    bookRows
      .map((r) => ((r.payload ?? {}) as { dateCompleted?: string }).dateCompleted)
      .filter((d): d is string => Boolean(d)),
  );

  const days: GaynessDay[] = [];
  for (let t = fromTs.getTime(); t <= Date.parse(`${end}T00:00:00.000Z`); t += DAY_MS) {
    const date = new Date(t).toISOString().slice(0, 10);
    const charges = chargesByDay.get(date) ?? [];
    const scored = scoreGayDay({
      transportation: charges.some((c) => c.category === "TRANSPORTATION"),
      productivityUnits:
        (contribByDay.get(date) ?? 0) +
        (todosByDay.get(date) ?? 0) +
        ((codingByDay.get(date) ?? 0) > 0 ? 1 : 0),
      streaming: charges.some((c) => STREAMING_MERCHANTS.some((m) => c.name.includes(m))),
      delivery: charges.some((c) => deliveryKeys.has(c.key)),
      socialEvent: socialDays.has(date),
      journaled: logDays.has(date),
      exercised: exerciseDays.has(date),
      finishedBook: bookDays.has(date),
      gayMerchant: gayKeys.size > 0 && charges.some((c) => gayKeys.has(c.key)),
      loanPayment: charges.some((c) => loanKeys.has(c.key)),
    });
    days.push({ date, ...scored });
  }
  return { days };
}
