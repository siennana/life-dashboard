import { and, asc, eq, sql } from "drizzle-orm";
import type { PortfolioResponse, PortfolioRisk, Position, RiskTier, SectorSlice } from "@life/shared";
import { events, metrics, type Db } from "@life/db";
import { getHoldings } from "./connectors/fidelity";
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

// Combine stored holdings with live quotes + beta into the dashboard payload.
// Without a Finnhub key we still return holdings (cost basis, quantity) but no
// prices, and risk can't be assessed without market values.
export async function buildPortfolio(
  db: Db,
  finnhubApiKey: string | undefined,
): Promise<PortfolioResponse> {
  const holdings = await getHoldings(db);
  const quotesConfigured = Boolean(finnhubApiKey);
  const symbols = holdings.map((h) => h.symbol);

  const [quotes, stats] = await Promise.all([
    finnhubApiKey && holdings.length > 0
      ? fetchQuotes(symbols, finnhubApiKey)
      : Promise.resolve(new Map()),
    holdings.length > 0
      ? fetchSymbolStats(symbols)
      : Promise.resolve(new Map<string, never>()),
  ]);

  const positions: Position[] = holdings.map((h) => {
    const quote = quotes.get(h.symbol) ?? null;
    const price = quote?.price ?? null;
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
    const s = stats.get(h.symbol) ?? null;
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
  const costBasis = sum(positions.map((p) => p.costBasis));
  const totalGain = sum(positions.map((p) => p.totalGain));
  const totalGainPct = totalGain != null && costBasis ? (totalGain / costBasis) * 100 : null;
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

  await recordPortfolioValue(db, marketValue, positions.length);

  return {
    positions: positions.sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0)),
    totals: {
      marketValue,
      costBasis,
      totalGain,
      totalGainPct,
      dayGain,
      dayGainPct,
    },
    sectors: sectorBreakdown(positions),
    history: await loadHistory(db),
    risk: assessRisk(positions),
    pricedAt: quotesConfigured && holdings.length > 0 ? new Date().toISOString() : null,
    holdingsAsOf: await loadHoldingsAsOf(db),
    quotesConfigured,
  };
}

// The CSV import stamps startTs = upload time on every holding row, so the
// newest startTs is when the portfolio was last uploaded.
async function loadHoldingsAsOf(db: Db): Promise<string | null> {
  const [row] = await db
    .select({ ts: sql<Date | null>`max(${events.startTs})` })
    .from(events)
    .where(and(eq(events.source, "fidelity"), eq(events.type, "holding")));
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

// Daily portfolio-value snapshot: one metrics row per calendar day, last write
// of the day wins. This series can't be backfilled — record it on every priced
// build (page loads and the 5-min sync loop). A failed snapshot must never
// break the portfolio response.
async function recordPortfolioValue(db: Db, marketValue: number | null, holdingCount: number) {
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
        source: "fidelity",
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
): Promise<{ date: string; value: number; capturedAt: string | null; backfilled: boolean }[]> {
  const rows = await db
    .select({ date: metrics.date, value: metrics.value, payload: metrics.payload })
    .from(metrics)
    .where(and(eq(metrics.source, "fidelity"), eq(metrics.name, "portfolio_value")))
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
