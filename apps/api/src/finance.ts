import type { PortfolioResponse, Position } from "@life/shared";
import type { Db } from "@life/db";
import { getHoldings } from "./connectors/fidelity";
import { fetchQuotes } from "./connectors/finnhub";

// Sum the non-null values; null if there's nothing to sum (so the UI can tell
// "zero" apart from "no data").
function sum(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v != null);
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
}

// Combine stored holdings with live quotes into the dashboard payload. Without
// a Finnhub key we still return holdings (cost basis, quantity) but no prices.
export async function buildPortfolio(
  db: Db,
  finnhubApiKey: string | undefined,
): Promise<PortfolioResponse> {
  const holdings = await getHoldings(db);
  const quotesConfigured = Boolean(finnhubApiKey);

  const quotes =
    finnhubApiKey && holdings.length > 0
      ? await fetchQuotes(
          holdings.map((h) => h.symbol),
          finnhubApiKey,
        )
      : new Map();

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
    };
  });

  const marketValue = sum(positions.map((p) => p.marketValue));
  const costBasis = sum(positions.map((p) => p.costBasis));
  const totalGain = sum(positions.map((p) => p.totalGain));
  const totalGainPct = totalGain != null && costBasis ? (totalGain / costBasis) * 100 : null;

  return {
    positions: positions.sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0)),
    totals: {
      marketValue,
      costBasis,
      totalGain,
      totalGainPct,
      dayGain: sum(positions.map((p) => p.dayGain)),
    },
    pricedAt: quotesConfigured && holdings.length > 0 ? new Date().toISOString() : null,
    quotesConfigured,
  };
}
