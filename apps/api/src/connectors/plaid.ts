import { and, desc, eq, inArray } from "drizzle-orm";
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

async function plaidPost<T>(creds: PlaidCreds, path: string, body: object): Promise<T> {
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

// One-time browser handshake, step 1: a short-lived token that opens Plaid Link.
export function createLinkToken(creds: PlaidCreds) {
  return plaidPost<{ link_token: string }>(creds, "/link/token/create", {
    client_name: "Life Dashboard",
    // Stable opaque id for Plaid's records - single-user app, so a constant.
    user: { client_user_id: "life-dashboard-user" },
    products: ["transactions"],
    // Max history Plaid allows. Only takes effect at link time, so getting more
    // than the 90-day default on an existing item means re-linking the bank.
    transactions: { days_requested: 730 },
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
