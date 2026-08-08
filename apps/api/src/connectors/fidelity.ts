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
  // "Current Value" column — needed for the core money-market position
  // (SPAXX), where Fidelity leaves Quantity blank and only reports dollars.
  currentValue: number | null;
};

// "$1,234.56" / "n/a" / "--" / "" → number | null
function parseMoney(raw: string | undefined): number | null {
  if (raw == null) return null;
  const cleaned = raw.replace(/[$,%\s]/g, "").replace(/[()]/g, "");
  if (cleaned === "" || /^(n\/?a|--)$/i.test(cleaned)) return null;
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
      currentValue: parseMoney(pick(row, ["currentvalue", "marketvalue", "value"])),
    });
  }

  return { holdings, skipped };
}

// Ingest a positions CSV: parse → upsert holdings → drop positions no longer
// present (sold). Records a sync_run like every other connector. `source`
// picks which account's holdings this replaces (fidelity/nm/factset — the
// loose header matching handles most broker exports, not just Fidelity's).
// On a Plaid-linked account a CSV is only a manual override: the next 5-min
// investments sync replaces it.
export async function importFidelityCsv(db: Db, csv: string, source = "fidelity") {
  const run = (await db.insert(syncRuns).values({ source }).returning())[0]!;
  try {
    const { holdings, skipped } = parseHoldings(csv);
    if (holdings.length === 0) {
      throw new Error("no holdings found - is this a Fidelity positions CSV with a Symbol column?");
    }

    const now = new Date();
    for (const h of holdings) {
      const payload = {
        quantity: h.quantity,
        costBasis: h.costBasis,
        description: h.description,
        currentValue: h.currentValue,
      };
      await db
        .insert(events)
        .values({
          source,
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
          eq(events.source, source),
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

// Read stored holdings back out for pricing/display. Rows come from the CSV
// import (externalId = symbol, no pricing extras) OR the Plaid investments
// sync once PLAID_FIDELITY_ACCESS_TOKEN is linked (externalId =
// security_id, payload carries symbol/institutionPrice/quotable/securityType
// in the connectors/plaid.ts shape) — read both.
export async function getHoldings(db: Db): Promise<
  (Holding & { institutionPrice: number | null; quotable?: boolean; isCash: boolean })[]
> {
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.source, "fidelity"), eq(events.type, "holding")));
  return rows.map((r) => {
    const p = (r.payload ?? {}) as Partial<Holding> & {
      symbol?: string;
      institutionPrice?: number | null;
      quotable?: boolean;
      securityType?: string | null;
    };
    return {
      symbol: p.symbol ?? r.externalId,
      description: p.description ?? r.title,
      quantity: p.quantity ?? null,
      costBasis: p.costBasis ?? null,
      currentValue: p.currentValue ?? null,
      institutionPrice: p.institutionPrice ?? null,
      // CSV rows have no flag -> undefined -> the pricing layer defaults to
      // quotable; Plaid rows carry an explicit boolean.
      quotable: p.quotable,
      isCash: p.securityType === "cash",
    };
  });
}
