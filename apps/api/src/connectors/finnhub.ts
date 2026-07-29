const API = "https://finnhub.io/api/v1";

// Live quotes are read on page load, so cache briefly: rapid refreshes reuse
// the same fetch instead of fanning out fresh calls and burning the 60/min
// free-tier limit.
const CACHE_TTL_MS = 45 * 1000;

export type Quote = {
  price: number;
  previousClose: number;
  dayChangePct: number;
};

type CacheEntry = { quote: Quote | null; expires: number };
const cache = new Map<string, CacheEntry>();

async function fetchQuote(symbol: string, key: string): Promise<Quote | null> {
  const url = new URL(`${API}/quote`);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("token", key);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Finnhub quote ${symbol} failed: ${res.status}`);
  const body = (await res.json()) as { c: number; pc: number; dp: number };
  // Finnhub returns c:0 for symbols it can't price (e.g. some mutual funds).
  if (!body.c) return null;
  return { price: body.c, previousClose: body.pc, dayChangePct: body.dp };
}

// Fetch quotes for many symbols, served from cache when fresh. Returns a map
// keyed by symbol; a null value means "no quote available for this symbol".
export async function fetchQuotes(
  symbols: string[],
  key: string,
): Promise<Map<string, Quote | null>> {
  const now = Date.now();
  const result = new Map<string, Quote | null>();
  const stale: string[] = [];

  for (const symbol of symbols) {
    const hit = cache.get(symbol);
    if (hit && hit.expires > now) result.set(symbol, hit.quote);
    else stale.push(symbol);
  }

  await Promise.all(
    stale.map(async (symbol) => {
      // A single symbol Finnhub can't price (403 for money-market/mutual funds
      // on the free tier, 429 when throttled, transient network errors) must
      // not blank the whole portfolio — treat it as "no quote" and move on.
      let quote: Quote | null = null;
      try {
        quote = await fetchQuote(symbol, key);
      } catch (err) {
        console.warn(`[finnhub] skipping ${symbol}: ${String(err)}`);
      }
      cache.set(symbol, { quote, expires: Date.now() + CACHE_TTL_MS });
      result.set(symbol, quote);
    }),
  );

  return result;
}
