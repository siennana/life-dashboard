import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import { events, syncRuns, type Db } from "@life/db";

// Bank spending via Plaid, read-only. Transactions normalize into `events`
// (source "plaid", type "transaction", externalId = transaction_id). Sync uses
// Plaid's incremental /transactions/sync; its cursor is persisted in
// sync_runs.cursor so each run resumes where the last successful one stopped.
const HOSTS: Record<string, string> = {
  sandbox: "https://sandbox.plaid.com",
  production: "https://production.plaid.com",
};

export type PlaidCreds = { clientId: string; secret: string; env: string };

export async function plaidPost<T>(creds: PlaidCreds, path: string, body: object): Promise<T> {
  const res = await fetch(`${HOSTS[creds.env] ?? HOSTS.production}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: creds.clientId, secret: creds.secret, ...body }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Plaid ${path} failed: ${res.status} ${detail.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

// One-time browser handshake, step 1: a short-lived token that opens Plaid
// Link. "transactions" = the bank item; "investments" = the NM brokerage item
// (holdings only — a separate Plaid item with its own access token).
export function createLinkToken(creds: PlaidCreds, mode: "transactions" | "investments" = "transactions") {
  return plaidPost<{ link_token: string }>(creds, "/link/token/create", {
    client_name: "Life Dashboard",
    // Stable opaque id for Plaid's records - single-user app, so a constant.
    user: { client_user_id: "life-dashboard-user" },
    products: [mode],
    // Max history Plaid allows. Only takes effect at link time, so getting more
    // than the 90-day default on an existing item means re-linking the bank.
    ...(mode === "transactions" ? { transactions: { days_requested: 730 } } : {}),
    country_codes: ["US"],
    language: "en",
  });
}

// Step 2: swap Link's public_token for the permanent access token (goes in .env).
export function exchangePublicToken(creds: PlaidCreds, publicToken: string) {
  return plaidPost<{ access_token: string; item_id: string }>(
    creds,
    "/item/public_token/exchange",
    { public_token: publicToken },
  );
}

type PlaidTransaction = {
  transaction_id: string;
  account_id: string;
  amount: number; // positive = money out, per Plaid convention
  iso_currency_code?: string | null;
  date: string; // YYYY-MM-DD
  authorized_date?: string | null; // when swiped, vs `date` = when posted
  name?: string;
  merchant_name?: string | null;
  logo_url?: string | null;
  payment_channel?: string | null; // online | in store | other
  pending: boolean;
  personal_finance_category?: { primary?: string; detailed?: string } | null;
};

type SyncPage = {
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  removed: { transaction_id?: string }[];
  next_cursor: string;
  has_more: boolean;
};

async function upsertTransaction(db: Db, t: PlaidTransaction) {
  const payload = {
    amount: t.amount,
    currency: t.iso_currency_code ?? "USD",
    pending: t.pending,
    accountId: t.account_id,
    category: t.personal_finance_category?.primary ?? null,
    categoryDetailed: t.personal_finance_category?.detailed ?? null,
    authorizedDate: t.authorized_date ?? null,
    logoUrl: t.logo_url ?? null,
    paymentChannel: t.payment_channel ?? null,
  };
  const title = t.merchant_name || t.name || "(unknown)";
  // Noon UTC keeps the transaction on its statement date regardless of TZ.
  const startTs = new Date(`${t.date}T12:00:00Z`);
  await db
    .insert(events)
    .values({
      source: "plaid",
      externalId: t.transaction_id,
      type: "transaction",
      title,
      startTs,
      payload,
    })
    .onConflictDoUpdate({
      target: [events.source, events.externalId],
      set: { title, startTs, payload, updatedAt: new Date() },
    });
}

type PlaidAccount = {
  account_id: string;
  name: string;
  official_name?: string | null;
  mask?: string | null;
  type: string; // depository | credit | loan | investment | other
  subtype?: string | null;
  balances: {
    current?: number | null;
    available?: number | null;
    limit?: number | null;
    iso_currency_code?: string | null;
  };
};

// Account metadata + live balances -> events (type "account"). Refreshed every
// sync so balances stay current; startTs records the as-of time.
async function syncAccounts(db: Db, creds: PlaidCreds, accessToken: string) {
  const { accounts } = await plaidPost<{ accounts: PlaidAccount[] }>(creds, "/accounts/get", {
    access_token: accessToken,
  });
  const now = new Date();
  for (const a of accounts) {
    const payload = {
      officialName: a.official_name ?? null,
      mask: a.mask ?? null,
      accountType: a.type,
      subtype: a.subtype ?? null,
      balanceCurrent: a.balances.current ?? null,
      balanceAvailable: a.balances.available ?? null,
      creditLimit: a.balances.limit ?? null,
      currency: a.balances.iso_currency_code ?? "USD",
    };
    await db
      .insert(events)
      .values({
        source: "plaid",
        externalId: a.account_id,
        type: "account",
        title: a.name,
        startTs: now,
        payload,
      })
      .onConflictDoUpdate({
        target: [events.source, events.externalId],
        set: { title: a.name, startTs: now, payload, updatedAt: now },
      });
  }
  return accounts.length;
}

// ---- Investment holdings via Plaid (NM + optionally Fidelity) ---------------
// Holdings only, via /investments/holdings/get (no incremental sync — Plaid
// returns the full current position list every call, so each run replaces).
// Rows land in `events` (source "nm" or "fidelity", type "holding",
// externalId = security_id — the stable key; tickers can be null for annuity
// sub-funds). For "fidelity" the first sync's prune also deletes the old
// CSV-upload rows (symbol externalIds) — Plaid becomes the source of truth,
// though a CSV upload still works as a manual override between syncs.

type PlaidInvestmentHolding = {
  account_id: string;
  security_id: string;
  quantity: number;
  institution_price?: number | null;
  institution_value?: number | null;
  cost_basis?: number | null;
  iso_currency_code?: string | null;
};

type PlaidSecurity = {
  security_id: string;
  ticker_symbol?: string | null;
  name?: string | null;
  type?: string | null; // equity | etf | mutual fund | cash | fixed income | ...
  close_price?: number | null;
};

export type NmHolding = {
  symbol: string;
  description: string | null;
  quantity: number | null;
  costBasis: number | null;
  // Custodian's own last price — the pricing fallback for securities Finnhub
  // can't quote (annuity sub-funds, mutual funds on the free tier).
  institutionPrice: number | null;
  // False when `symbol` is a display fallback, not a real exchange ticker —
  // those must never hit the quote providers. Learned the hard way: the cash
  // sweep's fallback symbol "CASH" is also Pathward Financial's real NASDAQ
  // ticker, which priced dollars at ~$87/share.
  quotable: boolean;
};

const TICKER_RE = /^[A-Z0-9.\-]{1,12}$/;

// Display symbol for a security: real ticker when it has one (quotable), else
// "CASH" for cash sweeps / the uppercased name head for annuity sub-funds —
// display-only fallbacks (quotable: false), priced via institution_price.
function nmSymbol(s: PlaidSecurity | undefined): { symbol: string; quotable: boolean } {
  const ticker = s?.ticker_symbol?.trim().toUpperCase() ?? "";
  if (s?.type !== "cash" && TICKER_RE.test(ticker)) return { symbol: ticker, quotable: true };
  if (s?.type === "cash") return { symbol: "CASH", quotable: false };
  return {
    symbol: (s?.name ?? s?.security_id ?? "UNKNOWN").toUpperCase().slice(0, 14).trim(),
    quotable: false,
  };
}

// One Plaid item can hold several real accounts (the Fidelity login covers
// the individual brokerage AND the FactSet 401k), and each dashboard account
// is its own source. `item` picks the routing: "nm" sends everything to
// source "nm"; "individual" splits by account subtype — 401k accounts feed
// source "factset", everything else "fidelity". Each source gets its own
// sync_runs row per run (they share the fate of the one API call).
export async function syncInvestmentHoldings(
  db: Db,
  creds: PlaidCreds,
  accessToken: string,
  item: "nm" | "individual",
) {
  const sources = item === "nm" ? ["nm"] : ["fidelity", "factset"];
  const runs = await db
    .insert(syncRuns)
    .values(sources.map((source) => ({ source })))
    .returning();
  try {
    const { accounts, holdings, securities } = await plaidPost<{
      accounts: { account_id: string; subtype?: string | null }[];
      holdings: PlaidInvestmentHolding[];
      securities: PlaidSecurity[];
    }>(creds, "/investments/holdings/get", { access_token: accessToken });
    const securityById = new Map(securities.map((s) => [s.security_id, s]));
    const subtypeByAccount = new Map(accounts.map((a) => [a.account_id, a.subtype ?? null]));
    const sourceOf = (accountId: string) =>
      item === "nm"
        ? "nm"
        : subtypeByAccount.get(accountId) === "401k"
          ? "factset"
          : "fidelity";

    // The same security can sit in several sub-accounts of one source — the
    // dashboard is per-position, so aggregate by (source, security).
    const bySecurity = new Map<string, PlaidInvestmentHolding[]>();
    for (const h of holdings) {
      const key = `${sourceOf(h.account_id)} ${h.security_id}`;
      const list = bySecurity.get(key) ?? [];
      list.push(h);
      bySecurity.set(key, list);
    }

    const now = new Date();
    const storedBySource = new Map<string, string[]>(sources.map((s) => [s, []]));
    for (const [key, rows] of bySecurity) {
      const [source, securityId] = key.split(" ") as [string, string];
      const s = securityById.get(securityId);
      const sumOf = (pick: (h: PlaidInvestmentHolding) => number | null | undefined) => {
        const present = rows.map(pick).filter((v): v is number => v != null);
        return present.length ? present.reduce((a, b) => a + b, 0) : null;
      };
      const { symbol, quotable } = nmSymbol(s);
      const isCash = s?.type === "cash";
      const quantity = sumOf((h) => h.quantity);
      // NM emits bookkeeping artifacts: zero-quantity zero-value cash rows
      // whose cost_basis carries an offsetting ledger amount. A holding with
      // nothing held and nothing valued is noise - skip it (the prune below
      // then deletes any previously stored copy).
      if (Math.abs(quantity ?? 0) < 1e-9 && Math.abs(sumOf((h) => h.institution_value) ?? 0) < 0.005) {
        continue;
      }
      const payload: NmHolding & { securityType: string | null; currency: string } = {
        symbol,
        quotable,
        description: s?.name ?? null,
        quantity,
        // Cash has no cost-basis semantics - Plaid's ledger figures there
        // poison the portfolio totals (a -$2,988 cash "cost" once turned into
        // a phantom +$2,988 total gain and a /~0 gain percentage).
        costBasis: isCash ? null : sumOf((h) => h.cost_basis),
        institutionPrice: rows[0]?.institution_price ?? s?.close_price ?? null,
        securityType: s?.type ?? null,
        currency: rows[0]?.iso_currency_code ?? "USD",
      };
      await db
        .insert(events)
        .values({
          source,
          externalId: securityId,
          type: "holding",
          title: payload.description ?? payload.symbol,
          startTs: now,
          payload,
        })
        .onConflictDoUpdate({
          target: [events.source, events.externalId],
          set: { title: payload.description ?? payload.symbol, startTs: now, payload, updatedAt: now },
        });
      storedBySource.get(source)!.push(securityId);
    }

    // A security missing from this pull (or skipped as an artifact above) was
    // sold — remove it per source (same replace semantics as the CSV upload;
    // for "fidelity" the first Plaid prune also clears the old CSV rows).
    for (const [source, keep] of storedBySource) {
      if (keep.length === 0) continue;
      await db
        .delete(events)
        .where(
          and(
            eq(events.source, source),
            eq(events.type, "holding"),
            notInArray(events.externalId, keep),
          ),
        );
    }

    await db
      .update(syncRuns)
      .set({ finishedAt: new Date(), status: "ok" })
      .where(inArray(syncRuns.id, runs.map((r) => r.id)));
    return {
      ok: true,
      holdings: Object.fromEntries([...storedBySource].map(([s, ids]) => [s, ids.length])),
    };
  } catch (err) {
    await db
      .update(syncRuns)
      .set({ finishedAt: new Date(), status: "error", error: String(err) })
      .where(inArray(syncRuns.id, runs.map((r) => r.id)));
    throw err;
  }
}

// Read stored Plaid-shape holdings back out for pricing/display (finance.ts).
// Works for any source the investments sync writes ("nm", "factset").
export async function getInvestmentHoldings(
  db: Db,
  source: string,
): Promise<(NmHolding & { isCash: boolean })[]> {
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.source, source), eq(events.type, "holding")));
  return rows.map((r) => {
    const p = (r.payload ?? {}) as Partial<NmHolding> & { securityType?: string | null };
    return {
      symbol: p.symbol ?? r.externalId,
      description: p.description ?? r.title,
      quantity: p.quantity ?? null,
      costBasis: p.costBasis ?? null,
      institutionPrice: p.institutionPrice ?? null,
      // Plaid-written rows always carry an explicit boolean; a CSV override
      // (no flag) has real tickers, so default quotable. The TICKER_RE filter
      // in finance.ts still keeps junk symbols away from the providers.
      quotable: p.quotable ?? true,
      isCash: p.securityType === "cash",
    };
  });
}

// A fresh cursor means a fresh Plaid item (first link OR a re-link, e.g. to
// raise days_requested). A re-linked item re-sends full history under brand-new
// transaction_ids, so any rows from the previous item must go or every
// transaction shows up twice. Safe to wipe: the full history follows.
async function wipeTransactions(db: Db) {
  await db.delete(events).where(and(eq(events.source, "plaid"), eq(events.type, "transaction")));
}

const isCursorError = (err: unknown) => String(err).includes("INVALID_CURSOR");

export async function syncPlaid(db: Db, creds: PlaidCreds, accessToken: string) {
  const run = (await db.insert(syncRuns).values({ source: "plaid" }).returning())[0]!;
  try {
    const accounts = await syncAccounts(db, creds, accessToken);

    // Resume from the last successful run's cursor (undefined = full history).
    const last = await db
      .select()
      .from(syncRuns)
      .where(and(eq(syncRuns.source, "plaid"), eq(syncRuns.status, "ok")))
      .orderBy(desc(syncRuns.startedAt))
      .limit(1);
    let cursor = last[0]?.cursor ?? undefined;

    if (!cursor) await wipeTransactions(db);

    let added = 0;
    let modified = 0;
    let removed = 0;
    let hasMore = true;
    while (hasMore) {
      let page: SyncPage;
      try {
        page = await plaidPost<SyncPage>(creds, "/transactions/sync", {
          access_token: accessToken,
          ...(cursor ? { cursor } : {}),
          count: 500,
        });
      } catch (err) {
        // Stored cursor belongs to a previous item (access token was swapped
        // after a re-link): start over from scratch for the new item.
        if (!cursor || !isCursorError(err)) throw err;
        cursor = undefined;
        await wipeTransactions(db);
        continue;
      }
      for (const t of [...page.added, ...page.modified]) await upsertTransaction(db, t);
      const removedIds = page.removed
        .map((r) => r.transaction_id)
        .filter((id): id is string => Boolean(id));
      if (removedIds.length > 0) {
        await db
          .delete(events)
          .where(
            and(
              eq(events.source, "plaid"),
              eq(events.type, "transaction"),
              inArray(events.externalId, removedIds),
            ),
          );
      }
      added += page.added.length;
      modified += page.modified.length;
      removed += removedIds.length;
      cursor = page.next_cursor;
      hasMore = page.has_more;
    }

    await db
      .update(syncRuns)
      .set({ finishedAt: new Date(), status: "ok", cursor })
      .where(eq(syncRuns.id, run.id));
    return { ok: true, accounts, added, modified, removed };
  } catch (err) {
    await db
      .update(syncRuns)
      .set({ finishedAt: new Date(), status: "error", error: String(err) })
      .where(eq(syncRuns.id, run.id));
    throw err;
  }
}
