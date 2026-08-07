import YahooFinance from "yahoo-finance2";

// Beta, sector, dividend yield and the 52-week range all come from one Yahoo
// quoteSummary call — free, no API key, and none of them are on Finnhub's free
// tier. These stats barely move, so cache them aggressively; a per-symbol
// failure yields nulls (unknown), never taking down the request.
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12h

export type SymbolStats = {
  beta: number | null;
  sector: string | null;
  dividendYieldPct: number | null;
  fiftyTwoWeekLow: number | null;
  fiftyTwoWeekHigh: number | null;
};

const EMPTY_STATS: SymbolStats = {
  beta: null,
  sector: null,
  dividendYieldPct: null,
  fiftyTwoWeekLow: null,
  fiftyTwoWeekHigh: null,
};

type CacheEntry = { stats: SymbolStats; expires: number };
const cache = new Map<string, CacheEntry>();

// suppressNotices quiets Yahoo's one-time survey banner; validation.logErrors
// off keeps schema-drift warnings (for fields we don't use) out of our logs.
const yf = new YahooFinance({
  suppressNotices: ["yahooSurvey"],
  validation: { logErrors: false },
});

// Minimal shape of the modules we read. validateResult:false skips the
// library's transform, so a field may arrive as a plain number or as Yahoo's
// { raw, fmt } wrapper depending on module — num() accepts both.
type StatsSummary = {
  defaultKeyStatistics?: { beta?: unknown; beta3Year?: unknown };
  summaryDetail?: {
    beta?: unknown;
    dividendYield?: unknown;
    yield?: unknown;
    trailingAnnualDividendYield?: unknown;
    fiftyTwoWeekLow?: unknown;
    fiftyTwoWeekHigh?: unknown;
  };
  assetProfile?: { sector?: unknown };
  fundProfile?: { categoryName?: unknown };
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(v: unknown): number | null {
  const n = typeof v === "object" && v != null && "raw" in v ? (v as { raw: unknown }).raw : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

async function fetchStats(symbol: string): Promise<SymbolStats> {
  const summary = (await yf.quoteSummary(
    symbol,
    { modules: ["defaultKeyStatistics", "summaryDetail", "assetProfile", "fundProfile"] },
    { validateResult: false },
  )) as StatsSummary;
  // Stocks expose `beta`; ETFs/funds often only expose `beta3Year`.
  const beta =
    num(summary.defaultKeyStatistics?.beta) ??
    num(summary.summaryDetail?.beta) ??
    num(summary.defaultKeyStatistics?.beta3Year);
  // assetProfile.sector only exists for individual stocks; for ETFs/funds fall
  // back to the fund category ("Technology", "Large Blend", ...) so an
  // ETF-heavy portfolio doesn't collapse into one giant "Other" bucket.
  const sector = str(summary.assetProfile?.sector) ?? str(summary.fundProfile?.categoryName);
  // Yahoo reports yield as a fraction (0.0143 = 1.43%). Stocks use
  // `dividendYield`; funds report theirs under `yield` — and a fund can carry
  // a literal 0 in `dividendYield`, so prefer the first positive value.
  const yieldCandidates = [
    num(summary.summaryDetail?.dividendYield),
    num(summary.summaryDetail?.yield),
    num(summary.summaryDetail?.trailingAnnualDividendYield),
  ].filter((v): v is number => v != null);
  const yieldFraction = yieldCandidates.find((v) => v > 0) ?? yieldCandidates[0] ?? null;
  return {
    beta,
    sector,
    dividendYieldPct: yieldFraction != null ? yieldFraction * 100 : null,
    fiftyTwoWeekLow: num(summary.summaryDetail?.fiftyTwoWeekLow),
    fiftyTwoWeekHigh: num(summary.summaryDetail?.fiftyTwoWeekHigh),
  };
}

export async function fetchSymbolStats(symbols: string[]): Promise<Map<string, SymbolStats>> {
  const now = Date.now();
  const result = new Map<string, SymbolStats>();
  const stale: string[] = [];

  for (const symbol of symbols) {
    const hit = cache.get(symbol);
    if (hit && hit.expires > now) result.set(symbol, hit.stats);
    else stale.push(symbol);
  }

  await Promise.all(
    stale.map(async (symbol) => {
      let stats = EMPTY_STATS;
      try {
        stats = await fetchStats(symbol);
      } catch (err) {
        console.warn(`[yahoo] no stats for ${symbol}: ${String(err)}`);
      }
      cache.set(symbol, { stats, expires: Date.now() + CACHE_TTL_MS });
      result.set(symbol, stats);
    }),
  );

  return result;
}
