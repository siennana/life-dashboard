import { and, asc, eq, sql } from "drizzle-orm";
import type { PortfolioResponse, PortfolioRisk, Position, RiskTier, SectorSlice, StockAccount } from "@life/shared";
import { events, metrics, syncRuns, type Db } from "@life/db";
import { getHoldings } from "./connectors/fidelity";
import { getInvestmentHoldings } from "./connectors/plaid";
import { fetchQuotes } from "./connectors/finnhub";
import { fetchSymbolStats } from "./connectors/yahoo";

// Sum the non-null values; null if there's nothing to sum (so the UI can tell
// "zero" apart from "no data").
function sum(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v != null);
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
}

// Map a holding's beta to a risk tier. Beta ~1 moves with the market; well
// above 1 is more volatile, below 1 is steadier. No beta → "unknown".
function betaToTier(beta: number | null): RiskTier {
  if (beta == null) return "unknown";
  if (beta < 0.75) return "low";
  if (beta < 1.1) return "moderate";
  if (beta < 1.5) return "elevated";
  return "high";
}

const TIER_RANK: Record<RiskTier, number> = {
  unknown: -1,
  low: 0,
  moderate: 1,
  elevated: 2,
  high: 3,
};
const RANK_TIER: RiskTier[] = ["low", "moderate", "elevated", "high"];

// Roll per-position risk up into one portfolio rating: beta weighted by dollar
// value, then bumped a notch if the portfolio is concentrated or heavy in
// volatile names.
function assessRisk(positions: Position[]): PortfolioRisk {
  const priced = positions.filter((p) => p.marketValue != null);
  const totalValue = sum(priced.map((p) => p.marketValue)) ?? 0;

  // Value-weighted portfolio beta over holdings that have both value and beta.
  const withBeta = priced.filter((p) => p.beta != null);
  const betaBase = sum(withBeta.map((p) => p.marketValue)) ?? 0;
  const portfolioBeta =
    betaBase > 0
      ? withBeta.reduce((acc, p) => acc + (p.beta as number) * (p.marketValue as number), 0) /
        betaBase
      : null;

  const top = priced.reduce<Position | null>(
    (best, p) => ((p.weightPct ?? 0) > (best?.weightPct ?? 0) ? p : best),
    null,
  );
  const topWeightPct = top?.weightPct ?? null;

  const highRiskValue =
    sum(priced.filter((p) => TIER_RANK[p.riskTier] >= 2).map((p) => p.marketValue)) ?? 0;
  const highRiskPct = totalValue > 0 ? (highRiskValue / totalValue) * 100 : null;

  // Base rating from portfolio beta.
  let rank: number;
  if (portfolioBeta == null) rank = -1;
  else if (portfolioBeta < 0.8) rank = 0;
  else if (portfolioBeta < 1.1) rank = 1;
  else if (portfolioBeta < 1.4) rank = 2;
  else rank = 3;

  // Concentration / high-risk bump.
  const concentrated = (topWeightPct ?? 0) > 30;
  const heavy = (highRiskPct ?? 0) > 40;
  if (rank >= 0 && (concentrated || heavy)) rank = Math.min(3, rank + 1);

  const rating: RiskTier = rank < 0 ? "unknown" : RANK_TIER[rank]!;

  const notes: string[] = [];
  if (portfolioBeta != null) {
    notes.push(
      `Portfolio beta ${portfolioBeta.toFixed(2)}, ${
        portfolioBeta > 1 ? "more volatile than" : portfolioBeta < 1 ? "steadier than" : "in line with"
      } the market.`,
    );
  }
  if (top && topWeightPct != null) {
    notes.push(
      `Largest position ${top.symbol} is ${topWeightPct.toFixed(0)}% of the portfolio${
        concentrated ? " (concentrated)." : "."
      }`,
    );
  }
  const highNames = priced.filter((p) => TIER_RANK[p.riskTier] >= 2).map((p) => p.symbol);
  if (highNames.length > 0 && highRiskPct != null) {
    notes.push(
      `${highRiskPct.toFixed(0)}% of value in higher-volatility holdings (${highNames
        .slice(0, 5)
        .join(", ")}${highNames.length > 5 ? "..." : ""}).`,
    );
  }
  const unknownCount = priced.filter((p) => p.riskTier === "unknown").length;
  if (unknownCount > 0) {
    notes.push(`${unknownCount} holding(s) have no beta available and are excluded from the score.`);
  }
  notes.push(`Based on ${withBeta.length} of ${priced.length} priced holdings.`);

  return {
    rating,
    portfolioBeta,
    topWeightPct,
    topSymbol: top?.symbol ?? null,
    highRiskPct,
    pricedHoldings: priced.length,
    notes,
  };
}

// A holding as the pricing pipeline sees it, whatever account it came from.
// `institutionPrice` (NM only) is the custodian's own last price — the
// fallback for securities the quote providers can't price.
type AccountHolding = {
  symbol: string;
  description: string | null;
  quantity: number | null;
  costBasis: number | null;
  institutionPrice?: number | null;
  // False = `symbol` is a display fallback (NM cash / annuity sub-funds), not
  // a real ticker — skip the quote providers. Absent (Fidelity CSV) = quotable.
  quotable?: boolean;
  // Cash positions (NM sweep, Fidelity money market): counted in market value
  // and the Cash stat, but never quoted and carrying no gain semantics.
  isCash?: boolean;
};

// Fidelity money-market/core-position symbols — cash in everything but name.
// Finnhub can't quote them (403) and their NAV is pegged at $1, so mark them
// cash and price at par: quantity = dollars. (Non-$1-NAV funds like FEDDX do
// NOT belong here — par-pricing them fabricates a value.)
const FIDELITY_CASH_SYMBOLS = new Set(["SPAXX", "FDRXX", "FZFXX", "FCASH", "FDIC"]);

// Individual holdings with cash stamping: money-market rows get isCash, a $1
// par price, and quotable:false (stops the pointless Finnhub 403 per cycle).
// Fidelity's CSV leaves Quantity blank for the core position (the balance is
// in Current Value), so at $1 par the dollars ARE the quantity.
async function loadIndividualHoldings(db: Db): Promise<AccountHolding[]> {
  return (await getHoldings(db)).map((h) => {
    const isCash = h.isCash || FIDELITY_CASH_SYMBOLS.has(h.symbol);
    if (!isCash) return h;
    return {
      ...h,
      isCash,
      quotable: false,
      institutionPrice: h.institutionPrice ?? 1,
      quantity: h.quantity ?? h.currentValue ?? null,
    };
  });
}

// Real-looking tickers only, and never display-fallback symbols — NM's cash
// sweep is labeled "CASH", which is also a real NASDAQ ticker (Pathward).
const quotableSymbols = (holdings: AccountHolding[]) =>
  holdings
    .filter((h) => (h.quotable ?? true) && TICKER_RE.test(h.symbol))
    .map((h) => h.symbol);

// Per-account wiring: where holdings come from and which `metrics`/`events`
// source the value history + holdingsAsOf live under. "individual" keeps the
// original "fidelity" source so its accumulated history is untouched.
const ACCOUNTS: Record<
  StockAccount,
  { source: string; loadHoldings: (db: Db) => Promise<AccountHolding[]> }
> = {
  individual: { source: "fidelity", loadHoldings: loadIndividualHoldings },
  nm: { source: "nm", loadHoldings: (db) => getInvestmentHoldings(db, "nm") },
  factset: { source: "factset", loadHoldings: (db) => getInvestmentHoldings(db, "factset") },
};

// Only real-looking tickers go to Finnhub/Yahoo — NM annuity sub-funds get a
// name-derived display symbol (spaces etc.) that would just 404/403 there.
const TICKER_RE = /^[A-Z0-9.\-]{1,12}$/;

export function loadAccountHoldings(db: Db, account: StockAccount) {
  return ACCOUNTS[account].loadHoldings(db);
}

// Combine stored holdings with live quotes + beta into the dashboard payload.
// Without a Finnhub key we still return holdings (cost basis, quantity) but no
// prices, and risk can't be assessed without market values.
export async function buildPortfolio(
  db: Db,
  finnhubApiKey: string | undefined,
  account: StockAccount = "individual",
  linked = true,
): Promise<PortfolioResponse> {
  const holdings = linked ? await loadAccountHoldings(db, account) : [];
  const quotesConfigured = Boolean(finnhubApiKey);
  const symbols = quotableSymbols(holdings);

  const [quotes, stats] = await Promise.all([
    finnhubApiKey && symbols.length > 0
      ? fetchQuotes(symbols, finnhubApiKey)
      : Promise.resolve(new Map()),
    symbols.length > 0
      ? fetchSymbolStats(symbols)
      : Promise.resolve(new Map<string, never>()),
  ]);

  const positions: Position[] = holdings.map((h) => {
    const quotable = h.quotable ?? true;
    const quote = quotable ? (quotes.get(h.symbol) ?? null) : null;
    const price = quote?.price ?? h.institutionPrice ?? null;
    const previousClose = quote?.previousClose ?? null;
    const marketValue = h.quantity != null && price != null ? h.quantity * price : null;
    const totalGain =
      marketValue != null && h.costBasis != null ? marketValue - h.costBasis : null;
    const totalGainPct =
      totalGain != null && h.costBasis ? (totalGain / h.costBasis) * 100 : null;
    const dayGain =
      h.quantity != null && price != null && previousClose != null
        ? h.quantity * (price - previousClose)
        : null;
    const s = quotable ? (stats.get(h.symbol) ?? null) : null;
    const beta = s?.beta ?? null;
    const low = s?.fiftyTwoWeekLow ?? null;
    const high = s?.fiftyTwoWeekHigh ?? null;
    const fiftyTwoWeekPct =
      price != null && low != null && high != null && high > low
        ? Math.min(100, Math.max(0, ((price - low) / (high - low)) * 100))
        : null;
    return {
      symbol: h.symbol,
      description: h.description,
      quantity: h.quantity,
      costBasis: h.costBasis,
      price,
      previousClose,
      dayChangePct: quote?.dayChangePct ?? null,
      marketValue,
      totalGain,
      totalGainPct,
      dayGain,
      beta,
      riskTier: betaToTier(beta),
      weightPct: null, // filled in below once the total is known
      sector: s?.sector ?? null,
      dividendYieldPct: s?.dividendYieldPct ?? null,
      fiftyTwoWeekLow: low,
      fiftyTwoWeekHigh: high,
      fiftyTwoWeekPct,
    };
  });

  const marketValue = sum(positions.map((p) => p.marketValue));
  // Positions map 1:1 from holdings, so index i pairs them for the cash split.
  const cashValue = sum(positions.map((p, i) => (holdings[i]!.isCash ? p.marketValue : null)));
  const costBasis = sum(positions.map((p) => p.costBasis));
  const totalGain = sum(positions.map((p) => p.totalGain));
  // Sub-cent base = no meaningful denominator. A truthy check alone once let a
  // 2e-13 float residue through and produced a 10^18 percent gain.
  const totalGainPct =
    totalGain != null && costBasis != null && Math.abs(costBasis) > 0.005
      ? (totalGain / costBasis) * 100
      : null;
  const dayGain = sum(positions.map((p) => p.dayGain));
  // Day % against yesterday's close value of the same positions, so the $ and
  // % always describe the same subset (positions with a quote).
  const prevCloseValue = sum(
    positions.map((p) =>
      p.dayGain != null && p.quantity != null && p.previousClose != null
        ? p.quantity * p.previousClose
        : null,
    ),
  );
  const dayGainPct = dayGain != null && prevCloseValue ? (dayGain / prevCloseValue) * 100 : null;

  // Position weights (share of total market value) — used for concentration.
  if (marketValue) {
    for (const p of positions) {
      p.weightPct = p.marketValue != null ? (p.marketValue / marketValue) * 100 : null;
    }
  }

  const source = ACCOUNTS[account].source;
  await recordPortfolioValue(db, source, marketValue, positions.length);

  return {
    positions: positions.sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0)),
    totals: {
      cashValue,
      marketValue,
      costBasis,
      totalGain,
      totalGainPct,
      dayGain,
      dayGainPct,
    },
    sectors: sectorBreakdown(positions),
    history: await loadHistory(db, source),
    risk: assessRisk(positions),
    pricedAt: quotesConfigured && holdings.length > 0 ? new Date().toISOString() : null,
    holdingsAsOf: await loadHoldingsAsOf(db, source),
    quotesConfigured,
    account,
    linked,
  };
}

// Record one sync_run around `fn`. A provider failing is logged as an error run
// but never rethrown, so one provider can't block the other or the snapshot.
async function recordProviderRun(db: Db, source: string, fn: () => Promise<unknown>) {
  const run = (await db.insert(syncRuns).values({ source }).returning())[0]!;
  try {
    await fn();
    await db
      .update(syncRuns)
      .set({ finishedAt: new Date(), status: "ok" })
      .where(eq(syncRuns.id, run.id));
  } catch (err) {
    await db
      .update(syncRuns)
      .set({ finishedAt: new Date(), status: "error", error: String(err) })
      .where(eq(syncRuns.id, run.id));
  }
}

// Scheduled market-data snapshot: contacts Finnhub (quotes) and Yahoo (stats),
// recording a sync_run per provider so each is its own row in the Sync status
// widget, then prices each account's portfolio + upserts today's value
// snapshots. buildPortfolio reuses the just-warmed 45s/12h caches, so the
// providers are hit once per cycle, not once per account. Only the 5-min loop
// calls this; page loads call buildPortfolio directly and don't record runs.
export async function syncPortfolioSnapshot(db: Db, finnhubApiKey: string, accounts: StockAccount[]) {
  const holdingLists = await Promise.all(accounts.map((a) => loadAccountHoldings(db, a)));
  const symbols = [...new Set(quotableSymbols(holdingLists.flat()))];
  await Promise.all([
    recordProviderRun(db, "finnhub", () => fetchQuotes(symbols, finnhubApiKey)),
    recordProviderRun(db, "yahoo", () => fetchSymbolStats(symbols)),
  ]);
  for (const account of accounts) await buildPortfolio(db, finnhubApiKey, account);
}

// When the holdings were last replaced: the Fidelity CSV import and the NM
// sync both stamp startTs = run time on every holding row, so the newest
// startTs is the last upload/sync for that account's source.
async function loadHoldingsAsOf(db: Db, source: string): Promise<string | null> {
  const [row] = await db
    .select({ ts: sql<Date | null>`max(${events.startTs})` })
    .from(events)
    .where(and(eq(events.source, source), eq(events.type, "holding")));
  return row?.ts ? new Date(row.ts).toISOString() : null;
}

// Priced value grouped by sector; funds/unknown fall into "Other". Sorted by
// value so the allocation chart reads top-down.
function sectorBreakdown(positions: Position[]): SectorSlice[] {
  const priced = positions.filter((p) => p.marketValue != null);
  const total = sum(priced.map((p) => p.marketValue)) ?? 0;
  if (total <= 0) return [];
  const groups = new Map<string, { value: number; positions: number }>();
  for (const p of priced) {
    const key = p.sector ?? "Other";
    const g = groups.get(key) ?? { value: 0, positions: 0 };
    g.value += p.marketValue as number;
    g.positions += 1;
    groups.set(key, g);
  }
  return [...groups.entries()]
    .map(([sector, g]) => ({
      sector,
      value: g.value,
      weightPct: (g.value / total) * 100,
      positions: g.positions,
    }))
    .sort((a, b) => b.value - a.value);
}

// Daily portfolio-value snapshot: one metrics row per calendar day per account
// source, last write of the day wins. This series can't be backfilled — record
// it on every priced build (page loads and the 5-min sync loop). A failed
// snapshot must never break the portfolio response.
async function recordPortfolioValue(
  db: Db,
  source: string,
  marketValue: number | null,
  holdingCount: number,
) {
  if (marketValue == null) return;
  const today = new Date().toLocaleDateString("en-CA"); // local YYYY-MM-DD
  const value = marketValue.toFixed(2);
  // capturedAt rides in the payload (not createdAt, which onConflict keeps at
  // the day's first write) so the last-write-wins value carries the wall time
  // it was actually computed.
  const payload = { holdings: holdingCount, capturedAt: new Date().toISOString() };
  try {
    await db
      .insert(metrics)
      .values({
        source,
        name: "portfolio_value",
        value,
        unit: "usd",
        date: today,
        payload,
      })
      .onConflictDoUpdate({
        target: [metrics.source, metrics.name, metrics.date],
        set: { value, payload },
      });
  } catch (err) {
    console.warn(`[finance] portfolio_value snapshot failed: ${String(err)}`);
  }
}

async function loadHistory(
  db: Db,
  source: string,
): Promise<{ date: string; value: number; capturedAt: string | null; backfilled: boolean }[]> {
  const rows = await db
    .select({ date: metrics.date, value: metrics.value, payload: metrics.payload })
    .from(metrics)
    .where(and(eq(metrics.source, source), eq(metrics.name, "portfolio_value")))
    .orderBy(asc(metrics.date));
  return rows.map((r) => {
    const p = (r.payload ?? {}) as { capturedAt?: string; backfilled?: boolean };
    return {
      date: r.date,
      value: Number(r.value),
      capturedAt: p.capturedAt ?? null,
      backfilled: p.backfilled === true,
    };
  });
}
