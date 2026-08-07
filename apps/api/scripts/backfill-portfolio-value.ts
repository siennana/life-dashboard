// One-time seed: reconstruct the daily `portfolio_value` series backwards from
// Yahoo's historical closes, for the gap before we started recording live
// snapshots (2026-08-07). Value each day = sum(current quantity * that day's
// close) over holdings Yahoo can price.
//
// This is only exact while your share counts haven't changed across the window
// — pass a --from date no earlier than your last buy/sell. Rows land with
// payload.backfilled = true and never overwrite a real snapshot (on-conflict do
// nothing on (source, name, date)), so it is idempotent.
//
//   pnpm backfill:portfolio --from 2026-07-08
//   pnpm backfill:portfolio --from 2026-07-08 --dry-run
//
// Runs against whatever DATABASE_URL points at (normally Neon), same as the app.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import YahooFinance from "yahoo-finance2";
import { createDb, metrics } from "@life/db";
import { getHoldings } from "../src/connectors/fidelity";
import { fetchQuotes } from "../src/connectors/finnhub";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
loadEnv({ path: resolve(repoRoot, ".env") });

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const fromArg = args[args.indexOf("--from") + 1];
const from = args.includes("--from") ? fromArg : undefined;

if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
  console.error("Usage: pnpm backfill:portfolio --from YYYY-MM-DD [--dry-run]");
  console.error("  --from should be the day AFTER your last buy/sell (share counts must be stable).");
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set (expected in .env).");
  process.exit(1);
}

const db = createDb(databaseUrl);
const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"], validation: { logErrors: false } });

// Yahoo daily bars are stamped at market time; read the calendar day in ET so
// it matches the live snapshot's local date and never shifts across midnight UTC.
const marketDay = (d: Date) =>
  d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });

async function main() {
  let holdings = (await getHoldings(db)).filter((h) => h.quantity != null);
  if (holdings.length === 0) {
    console.error("No holdings with quantities found — upload a Fidelity CSV first.");
    process.exit(1);
  }

  // Match the live series' composition exactly: the daily snapshots value only
  // what Finnhub can price (money-market/mutual funds like SPAXX/FEDDX come back
  // null), so restrict the backfill to that same set — otherwise a fund Yahoo
  // *can* price would inflate the historical days and leave a fake step at the
  // seam where the live snapshots take over. No key → price whatever Yahoo has.
  const finnhubKey = process.env.FINNHUB_API_KEY;
  if (finnhubKey) {
    const quotes = await fetchQuotes(holdings.map((h) => h.symbol), finnhubKey);
    const excluded = holdings.filter((h) => quotes.get(h.symbol) == null).map((h) => h.symbol);
    holdings = holdings.filter((h) => quotes.get(h.symbol) != null);
    if (excluded.length) console.log(`Excluded (not priced by the live series): ${excluded.join(", ")}`);
  } else {
    console.warn("FINNHUB_API_KEY not set — pricing every holding Yahoo can, which may not match the live series.");
  }

  const today = marketDay(new Date());
  console.log(`Backfilling portfolio value ${from} → ${today} from ${holdings.length} holdings.\n`);

  // symbol -> (YYYY-MM-DD -> close). One chart call per symbol; a symbol Yahoo
  // can't price (some money-market funds) is skipped, same as live pricing.
  const closes = new Map<string, Map<string, number>>();
  const priced: string[] = [];
  const unpriced: string[] = [];

  for (const h of holdings) {
    try {
      const res = await yf.chart(h.symbol, { period1: from, period2: today, interval: "1d" });
      const byDay = new Map<string, number>();
      for (const q of res.quotes) {
        if (q.close != null) byDay.set(marketDay(q.date), q.close);
      }
      if (byDay.size > 0) {
        closes.set(h.symbol, byDay);
        priced.push(h.symbol);
      } else {
        unpriced.push(h.symbol);
      }
    } catch (err) {
      unpriced.push(h.symbol);
      console.warn(`  [skip] ${h.symbol}: ${String(err)}`);
    }
  }

  console.log(`Priced ${priced.length}: ${priced.join(", ")}`);
  if (unpriced.length) console.log(`Unpriced (excluded): ${unpriced.join(", ")}\n`);

  // The union of every trading day we saw, ascending. Weekends/holidays simply
  // don't appear — the chart plots against real dates, so gaps are fine.
  const days = [...new Set([...closes.values()].flatMap((m) => [...m.keys()]))]
    .filter((d) => d >= from! && d < today) // stop before today; the live Aug-7 snapshot owns it
    .sort();

  if (days.length === 0) {
    console.log("No trading days to backfill in that window.");
    process.exit(0);
  }

  const rows = days.map((day) => {
    let value = 0;
    let n = 0;
    for (const h of holdings) {
      const close = closes.get(h.symbol)?.get(day);
      if (close != null) {
        value += h.quantity! * close;
        n += 1;
      }
    }
    return { day, value: Number(value.toFixed(2)), holdings: n };
  });

  console.log("Reconstructed daily value:");
  for (const r of rows) console.log(`  ${r.day}  $${r.value.toLocaleString()}  (${r.holdings} priced)`);

  if (dryRun) {
    console.log("\n--dry-run: nothing written.");
    process.exit(0);
  }

  let inserted = 0;
  for (const r of rows) {
    const res = await db
      .insert(metrics)
      .values({
        source: "fidelity",
        name: "portfolio_value",
        value: r.value.toFixed(2),
        unit: "usd",
        date: r.day,
        payload: { holdings: r.holdings, backfilled: true },
      })
      .onConflictDoNothing({ target: [metrics.source, metrics.name, metrics.date] })
      .returning({ id: metrics.id });
    inserted += res.length;
  }

  console.log(`\nDone. Inserted ${inserted} new day(s); skipped ${rows.length - inserted} already present.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
