import YahooFinance from "yahoo-finance2";

// Beta (volatility vs. the market) is our risk signal. Finnhub's free tier
// doesn't expose it, so we read it from Yahoo — free, no API key. Beta barely
// moves, so cache it aggressively; a per-symbol failure yields null (unknown),
// never taking down the request.
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12h

type CacheEntry = { beta: number | null; expires: number };
const cache = new Map<string, CacheEntry>();

// suppressNotices quiets Yahoo's one-time survey banner; validation.logErrors
// off keeps schema-drift warnings (for fields we don't use) out of our logs.
const yf = new YahooFinance({
  suppressNotices: ["yahooSurvey"],
  validation: { logErrors: false },
});

// Minimal shape of the two modules we read; validateResult:false returns
// `unknown`, but skipping validation means unrelated field drift can't throw.
type BetaSummary = {
  defaultKeyStatistics?: { beta?: number; beta3Year?: number };
  summaryDetail?: { beta?: number };
};

async function fetchBeta(symbol: string): Promise<number | null> {
  const summary = (await yf.quoteSummary(
    symbol,
    { modules: ["defaultKeyStatistics", "summaryDetail"] },
    { validateResult: false },
  )) as BetaSummary;
  // Stocks expose `beta`; ETFs/funds often only expose `beta3Year`.
  const beta =
    summary.defaultKeyStatistics?.beta ??
    summary.summaryDetail?.beta ??
    summary.defaultKeyStatistics?.beta3Year ??
    null;
  return typeof beta === "number" && Number.isFinite(beta) ? beta : null;
}

export async function fetchBetas(symbols: string[]): Promise<Map<string, number | null>> {
  const now = Date.now();
  const result = new Map<string, number | null>();
  const stale: string[] = [];

  for (const symbol of symbols) {
    const hit = cache.get(symbol);
    if (hit && hit.expires > now) result.set(symbol, hit.beta);
    else stale.push(symbol);
  }

  await Promise.all(
    stale.map(async (symbol) => {
      let beta: number | null = null;
      try {
        beta = await fetchBeta(symbol);
      } catch (err) {
        console.warn(`[yahoo] no beta for ${symbol}: ${String(err)}`);
      }
      cache.set(symbol, { beta, expires: Date.now() + CACHE_TTL_MS });
      result.set(symbol, beta);
    }),
  );

  return result;
}
