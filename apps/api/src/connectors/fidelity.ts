import Papa from "papaparse";
import { and, eq, notInArray } from "drizzle-orm";
import { events, syncRuns, type Db } from "@life/db";

// Fidelity's "Positions" export is a plain CSV with a header row. Column names
// vary a little across account types, so we match them loosely (case- and
// space-insensitive) rather than hard-coding exact strings. We only require
// Symbol + a cost-basis column; Quantity/Description are used when present.
type Holding = {
  symbol: string;
  description: string | null;
  quantity: number | null;
  costBasis: number | null;
};

// "$1,234.56" / "n/a" / "--" / "" → number | null
function parseMoney(raw: string | undefined): number | null {
  if (raw == null) return null;
  const cleaned = raw.replace(/[$,%\s]/g, "").replace(/[()]/g, "");
  if (cleaned === "" || /^(n\/?a|--|—)$/i.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function normalizeKey(k: string): string {
  return k.toLowerCase().replace(/[^a-z]/g, "");
}

// Find the first row value whose header (normalized) matches one of `candidates`.
function pick(row: Record<string, string>, candidates: string[]): string | undefined {
  for (const [key, value] of Object.entries(row)) {
    if (candidates.includes(normalizeKey(key))) return value;
  }
  return undefined;
}

export function parseHoldings(csv: string): { holdings: Holding[]; skipped: number } {
  const { data } = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: "greedy",
  });

  const holdings: Holding[] = [];
  let skipped = 0;

  for (const row of data) {
    const rawSymbol = pick(row, ["symbol", "ticker"])?.trim() ?? "";
    // Strip Fidelity's money-market asterisks (e.g. "SPAXX**").
    const symbol = rawSymbol.replace(/\*+$/, "").toUpperCase();
    // Skip disclaimer/footer lines and non-position rows like "Pending Activity".
    if (!/^[A-Z0-9.\-]{1,12}$/.test(symbol)) {
      if (rawSymbol) skipped++;
      continue;
    }
    holdings.push({
      symbol,
      description: pick(row, ["description", "securitydescription", "name"])?.trim() || null,
      quantity: parseMoney(pick(row, ["quantity", "shares"])),
      costBasis: parseMoney(
        pick(row, ["costbasistotal", "costbasis", "totalcostbasis"]),
      ),
    });
  }

  return { holdings, skipped };
}

// Ingest a Fidelity CSV: parse → upsert holdings → drop positions no longer
// present (sold). Records a sync_run like every other connector.
export async function importFidelityCsv(db: Db, csv: string) {
  const run = (await db.insert(syncRuns).values({ source: "fidelity" }).returning())[0]!;
  try {
    const { holdings, skipped } = parseHoldings(csv);
    if (holdings.length === 0) {
      throw new Error("no holdings found — is this a Fidelity positions CSV with a Symbol column?");
    }

    const now = new Date();
    for (const h of holdings) {
      const payload = { quantity: h.quantity, costBasis: h.costBasis, description: h.description };
      await db
        .insert(events)
        .values({
          source: "fidelity",
          externalId: h.symbol,
          type: "holding",
          title: h.description ?? h.symbol,
          startTs: now,
          payload,
        })
        .onConflictDoUpdate({
          target: [events.source, events.externalId],
          set: { title: h.description ?? h.symbol, startTs: now, payload, updatedAt: now },
        });
    }

    // A position missing from this upload was sold — remove it.
    const symbols = holdings.map((h) => h.symbol);
    await db
      .delete(events)
      .where(
        and(
          eq(events.source, "fidelity"),
          eq(events.type, "holding"),
          notInArray(events.externalId, symbols),
        ),
      );

    await db
      .update(syncRuns)
      .set({ finishedAt: new Date(), status: "ok" })
      .where(eq(syncRuns.id, run.id));
    return { imported: holdings.length, symbols, skipped };
  } catch (err) {
    await db
      .update(syncRuns)
      .set({ finishedAt: new Date(), status: "error", error: String(err) })
      .where(eq(syncRuns.id, run.id));
    throw err;
  }
}

// Read stored holdings back out for pricing/display.
export async function getHoldings(db: Db): Promise<Holding[]> {
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.source, "fidelity"), eq(events.type, "holding")));
  return rows.map((r) => {
    const p = (r.payload ?? {}) as Partial<Holding>;
    return {
      symbol: r.externalId,
      description: p.description ?? r.title,
      quantity: p.quantity ?? null,
      costBasis: p.costBasis ?? null,
    };
  });
}
