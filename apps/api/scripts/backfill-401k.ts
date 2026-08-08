// One-time seed of the FactSet 401k's daily `portfolio_value` series (source
// "factset") for the gap before live snapshots existed.
//
// The 401k fund has no ticker, so there is no Yahoo close to lean on. Instead
// everything comes from Plaid's investment transactions (real custodian data):
//   - units held per day: walk the buy/sell quantities backwards from the
//     current stored quantity;
//   - NAV per day: linear interpolation between the per-transaction prices
//     (biweekly contributions = biweekly NAV samples), anchored at today's
//     institution price.
// Value each weekday = sum(units(day) * nav(day)) over the account's
// securities. Rows land with payload.backfilled = true and never overwrite a
// real snapshot (on-conflict do nothing), so it is idempotent.
//
//   pnpm backfill:401k [--dry-run]
//
// Runs against whatever DATABASE_URL points at (normally Neon), same as the app.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { and, eq } from "drizzle-orm";
import { createDb, events, metrics } from "@life/db";
import { plaidPost, type PlaidCreds } from "../src/connectors/plaid";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
loadEnv({ path: resolve(repoRoot, ".env") });

const dryRun = process.argv.includes("--dry-run");

const databaseUrl = process.env.DATABASE_URL;
const clientId = process.env.PLAID_CLIENT_ID;
const secret = process.env.PLAID_SECRET;
const accessToken = process.env.PLAID_FIDELITY_ACCESS_TOKEN;
if (!databaseUrl || !clientId || !secret || !accessToken) {
  console.error(
    "Missing env - need DATABASE_URL, PLAID_CLIENT_ID, PLAID_SECRET, PLAID_FIDELITY_ACCESS_TOKEN.",
  );
  process.exit(1);
}
const creds: PlaidCreds = { clientId, secret, env: process.env.PLAID_ENV ?? "production" };
const db = createDb(databaseUrl);

type InvestmentTx = {
  investment_transaction_id: string;
  account_id: string;
  security_id?: string | null;
  date: string; // YYYY-MM-DD
  quantity: number; // signed unit delta for buy/sell
  amount: number; // dollars (positive = money in for buys)
  price?: number | null;
  type: string; // buy | sell | cash | fee | transfer
};

// Per-transaction NAV: Fidelity's 401k feed leaves `price` null, but each
// contribution's amount/quantity IS that day's NAV.
const txPrice = (t: InvestmentTx): number | null => {
  if (t.price != null && t.price > 0) return t.price;
  if (t.quantity !== 0 && t.amount !== 0) return Math.abs(t.amount / t.quantity);
  return null;
};

type TxPage = {
  accounts: { account_id: string; subtype?: string | null }[];
  investment_transactions: InvestmentTx[];
  total_investment_transactions: number;
};

const day = (d: Date) => d.toLocaleDateString("en-CA");
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return day(d);
};
const isWeekday = (iso: string) => {
  const dow = new Date(`${iso}T12:00:00`).getDay();
  return dow >= 1 && dow <= 5;
};

async function main() {
  // Current holdings = the reconstruction's anchor (units today + today's NAV).
  const held = await db
    .select()
    .from(events)
    .where(and(eq(events.source, "factset"), eq(events.type, "holding")));
  if (held.length === 0) {
    console.error("No factset holdings stored - run the fidelity sync first.");
    process.exit(1);
  }
  const anchors = new Map(
    held.map((r) => {
      const p = (r.payload ?? {}) as { quantity?: number; institutionPrice?: number };
      return [r.externalId, { qty: p.quantity ?? 0, price: p.institutionPrice ?? null }];
    }),
  );

  // Pull the full available investment-transaction history (Plaid caps most
  // institutions around 24 months).
  const start = day(new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000));
  const end = day(new Date());
  const txs: InvestmentTx[] = [];
  let accounts: TxPage["accounts"] = [];
  for (let offset = 0; ; ) {
    const page = await plaidPost<TxPage>(creds, "/investments/transactions/get", {
      access_token: accessToken,
      start_date: start,
      end_date: end,
      options: { count: 500, offset },
    });
    accounts = page.accounts;
    txs.push(...page.investment_transactions);
    offset += page.investment_transactions.length;
    if (offset >= page.total_investment_transactions || page.investment_transactions.length === 0) break;
  }

  // Only the 401k account's share-moving transactions matter here.
  const k401 = new Set(accounts.filter((a) => a.subtype === "401k").map((a) => a.account_id));
  const fundTxs = txs
    .filter((t) => k401.has(t.account_id) && t.security_id && t.quantity !== 0)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  if (fundTxs.length === 0) {
    console.error("Plaid returned no share-moving 401k transactions - nothing to reconstruct.");
    process.exit(1);
  }
  console.log(`401k transactions: ${fundTxs.length}, ${fundTxs[0]!.date} -> ${fundTxs[fundTxs.length - 1]!.date}`);

  const securityIds = [...new Set(fundTxs.map((t) => t.security_id as string))];
  const firstDay = fundTxs[0]!.date;
  const today = end;

  // Plaid can issue different security_ids for the same fund between the
  // holdings and transactions endpoints. With exactly one of each, pair them.
  if (securityIds.length === 1 && anchors.size === 1 && !anchors.has(securityIds[0]!)) {
    const [only] = anchors.values();
    anchors.set(securityIds[0]!, only!);
    console.log("(aliased the transaction security to the single stored holding)");
  }

  // Per security: unit balance at window start = today's units minus every
  // delta in the window; NAV samples = (date, price) per transaction plus
  // today's institution price.
  const perSecurity = securityIds.map((sid) => {
    const mine = fundTxs.filter((t) => t.security_id === sid);
    const deltaSum = mine.reduce((a, t) => a + t.quantity, 0);
    const anchor = anchors.get(sid) ?? { qty: 0, price: null };
    const startQty = anchor.qty - deltaSum;
    const samples: { date: string; price: number }[] = mine
      .map((t) => ({ date: t.date, price: txPrice(t) }))
      .filter((s): s is { date: string; price: number } => s.price != null);
    if (anchor.price != null) samples.push({ date: today, price: anchor.price });
    return { sid, mine, startQty, samples };
  });

  // NAV on a day: linear interpolation between the surrounding samples (flat
  // beyond the ends). Samples are date-ascending (txs sorted + today appended).
  const ms = (iso: string) => new Date(`${iso}T12:00:00`).getTime();
  const navOn = (samples: { date: string; price: number }[], d: string): number | null => {
    if (samples.length === 0) return null;
    const before = [...samples].reverse().find((s) => s.date <= d);
    const after = samples.find((s) => s.date >= d);
    if (!before) return after!.price; // flat before first sample
    if (!after) return before.price; // flat after last sample
    if (before.date === after.date) return before.price;
    const t = (ms(d) - ms(before.date)) / (ms(after.date) - ms(before.date));
    return before.price + (after.price - before.price) * t;
  };

  // Walk the window day by day, applying unit deltas on their date.
  const qty = new Map(perSecurity.map((s) => [s.sid, s.startQty]));
  const txByDay = new Map<string, InvestmentTx[]>();
  for (const t of fundTxs) {
    const list = txByDay.get(t.date) ?? [];
    list.push(t);
    txByDay.set(t.date, list);
  }

  const rows: { day: string; value: number }[] = [];
  for (let d = firstDay; d < today; d = addDays(d, 1)) {
    for (const t of txByDay.get(d) ?? []) {
      qty.set(t.security_id as string, (qty.get(t.security_id as string) ?? 0) + t.quantity);
    }
    if (!isWeekday(d)) continue;
    let value = 0;
    for (const s of perSecurity) {
      const q = qty.get(s.sid) ?? 0;
      if (Math.abs(q) < 1e-9) continue;
      const nav = navOn(s.samples, d);
      if (nav != null) value += q * nav;
    }
    if (value > 0) rows.push({ day: d, value: Number(value.toFixed(2)) });
  }

  // Reconstruction summary per security - the first thing to read when the
  // output looks wrong (anchor mismatches show up here).
  for (const s of perSecurity) {
    const anchor = anchors.get(s.sid);
    console.log(
      `security ${s.sid.slice(0, 12)}...: txs=${s.mine.length} deltaSum=${s.mine
        .reduce((a, t) => a + t.quantity, 0)
        .toFixed(3)} startQty=${s.startQty.toFixed(3)} samples=${s.samples.length} anchor=${
        anchor ? `${anchor.qty}@${anchor.price}` : "MISSING"
      }`,
    );
  }

  console.log(`Reconstructed ${rows.length} weekday values:`);
  for (const r of rows.filter((_, i) => i % 20 === 0)) {
    console.log(`  ${r.day}  $${r.value.toLocaleString()}`);
  }
  console.log(`  ...  ${rows[rows.length - 1]?.day}  $${rows[rows.length - 1]?.value.toLocaleString()}`);

  if (dryRun) {
    console.log("\n--dry-run: nothing written.");
    process.exit(0);
  }

  let inserted = 0;
  for (const r of rows) {
    const res = await db
      .insert(metrics)
      .values({
        source: "factset",
        name: "portfolio_value",
        value: r.value.toFixed(2),
        unit: "usd",
        date: r.day,
        payload: { holdings: 1, backfilled: true },
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
