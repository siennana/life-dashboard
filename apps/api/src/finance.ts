import type { PortfolioResponse, PortfolioRisk, Position, RiskTier } from "@life/shared";
import type { Db } from "@life/db";
import { getHoldings } from "./connectors/fidelity";
import { fetchQuotes } from "./connectors/finnhub";
import { fetchBetas } from "./connectors/yahoo";

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

  const [quotes, betas] = await Promise.all([
    finnhubApiKey && holdings.length > 0
      ? fetchQuotes(symbols, finnhubApiKey)
      : Promise.resolve(new Map()),
    holdings.length > 0 ? fetchBetas(symbols) : Promise.resolve(new Map()),
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
    const beta = betas.get(h.symbol) ?? null;
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
    };
  });

  const marketValue = sum(positions.map((p) => p.marketValue));
  const costBasis = sum(positions.map((p) => p.costBasis));
  const totalGain = sum(positions.map((p) => p.totalGain));
  const totalGainPct = totalGain != null && costBasis ? (totalGain / costBasis) * 100 : null;

  // Position weights (share of total market value) — used for concentration.
  if (marketValue) {
    for (const p of positions) {
      p.weightPct = p.marketValue != null ? (p.marketValue / marketValue) * 100 : null;
    }
  }

  return {
    positions: positions.sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0)),
    totals: {
      marketValue,
      costBasis,
      totalGain,
      totalGainPct,
      dayGain: sum(positions.map((p) => p.dayGain)),
    },
    risk: assessRisk(positions),
    pricedAt: quotesConfigured && holdings.length > 0 ? new Date().toISOString() : null,
    quotesConfigured,
  };
}
