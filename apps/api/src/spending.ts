import { and, eq } from "drizzle-orm";
import { events, type Db } from "@life/db";
import type {
  CashflowResponse,
  DayTransactionsResponse,
  RecurringCharge,
  SpendingDashboard,
} from "@life/shared";

// Internal money movement, not real spending: account-to-account transfers,
// moves into own investment/savings, and credit-card payments (the purchases
// they pay off are already counted). Keyed on Plaid's detailed category;
// LOAN_PAYMENTS_OTHER_PAYMENT is US Bank's card-payment categorization here.
// Real external payments (Zelle/Venmo, student loans, rent) still count.
export const NON_SPEND_DETAILED = new Set([
  "TRANSFER_OUT_ACCOUNT_TRANSFER",
  "TRANSFER_OUT_WITHDRAWAL",
  "TRANSFER_OUT_SAVINGS",
  "TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS",
  "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
  "LOAN_PAYMENTS_OTHER_PAYMENT",
]);

// Inbound counterparts of the above (paycheck deposits are INCOME, not these).
const NON_INCOME_DETAILED_PREFIX = "TRANSFER_IN_";

type TxPayload = {
  amount?: number;
  pending?: boolean;
  accountId?: string;
  category?: string | null;
  categoryDetailed?: string | null;
};

type AccountPayload = {
  mask?: string | null;
  accountType?: string | null;
  subtype?: string | null;
  balanceCurrent?: number | null;
  creditLimit?: number | null;
};

type Tx = {
  id: number;
  date: string; // YYYY-MM-DD
  month: string; // YYYY-MM
  name: string;
  amount: number;
  pending: boolean;
  accountId: string | null;
  category: string | null;
  detailed: string | null;
};

// Statement descriptors mangle brand names ("Chidoordash.comca" = a DoorDash
// restaurant charge). Collapse known brands to one merchant so per-merchant
// totals and recurring detection see them as a single stream. Substring match
// on the lowercased raw name; order matters (uber eats before uber).
const BRANDS: [string, string][] = [
  ["doordash", "DoorDash"],
  ["uber eats", "Uber Eats"],
  ["ubereats", "Uber Eats"],
  ["uber", "Uber"],
  ["lyft", "Lyft"],
  ["instacart", "Instacart"],
  ["amazon prime", "Amazon Prime"],
  ["amzn", "Amazon"],
  ["amazon", "Amazon"],
  ["venmo", "Venmo"],
  ["zelle", "Zelle"],
  ["starbucks", "Starbucks"],
  ["dunkin", "Dunkin"],
];

function normalizeMerchant(raw: string): string {
  const lower = raw.toLowerCase();
  for (const [needle, brand] of BRANDS) if (lower.includes(needle)) return brand;
  return raw;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const addDays = (date: string, days: number) =>
  new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10);

// A transaction counts toward "spend" when money actually left for the outside
// world. Refunds (negative, non-income, non-transfer) subtract from spend.
const isSpend = (t: Tx) => t.amount > 0 && !(t.detailed && NON_SPEND_DETAILED.has(t.detailed));
const isRefund = (t: Tx) =>
  t.amount < 0 &&
  t.category !== "INCOME" &&
  !(t.detailed ?? "").startsWith(NON_INCOME_DETAILED_PREFIX);
const isIncome = (t: Tx) => t.amount < 0 && t.category === "INCOME";

// One plaid transaction row → Tx. Shared by the spending dashboard and the
// daily cashflow so both classify amounts identically.
function toTx(r: typeof events.$inferSelect): Tx {
  const p = (r.payload ?? {}) as TxPayload;
  const date = r.startTs.toISOString().slice(0, 10);
  return {
    id: r.id,
    date,
    month: date.slice(0, 7),
    name: r.title ?? "(unknown)",
    amount: p.amount ?? 0,
    pending: p.pending ?? false,
    accountId: p.accountId ?? null,
    category: p.category ?? null,
    detailed: p.categoryDetailed ?? null,
  };
}

async function loadTxs(db: Db): Promise<Tx[]> {
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.source, "plaid"), eq(events.type, "transaction")));
  return rows.map(toTx);
}

// Net cashflow per day: income (paychecks) minus spend (net of refunds, with
// internal transfers / card payments excluded — same rules as the Bank page).
// `net > 0` = money in on balance, `net < 0` = money out. Days with no real
// movement are dropped. Powers the per-day figure on the calendar grid.
export async function buildDailyCashflow(db: Db): Promise<CashflowResponse> {
  const txs = await loadTxs(db);
  const byDay = new Map<string, { spend: number; income: number }>();
  for (const t of txs) {
    const cur = byDay.get(t.date) ?? { spend: 0, income: 0 };
    if (isSpend(t) || isRefund(t)) cur.spend += t.amount;
    else if (isIncome(t)) cur.income += -t.amount;
    byDay.set(t.date, cur);
  }
  const days = [...byDay.entries()]
    .map(([date, v]) => ({
      date,
      spend: round2(v.spend),
      income: round2(v.income),
      net: round2(v.income - v.spend),
    }))
    .filter((d) => d.spend !== 0 || d.income !== 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  return { days };
}

// Every plaid transaction on one day (newest id first), for the calendar's
// day-detail Transactions list. Raw rows — no spend/transfer filtering — so the
// day view shows exactly what hit the accounts.
export async function buildDayTransactions(db: Db, date: string): Promise<DayTransactionsResponse> {
  const txs = await loadTxs(db);
  const transactions = txs
    .filter((t) => t.date === date)
    .sort((a, b) => b.id - a.id)
    .map(({ id, date, name, amount, category, pending, accountId }) => ({
      id,
      date,
      name,
      amount,
      category,
      pending,
      accountId,
    }));
  return { date, transactions };
}

// Fixed-cadence charges (rent, subscriptions, insurance) detected from the
// history itself: same merchant, steady amount, steady gap. Plaid has a paid
// endpoint for this; the DIY version is fine for one person's accounts.
function detectRecurring(spend: Tx[], today: string): RecurringCharge[] {
  const byMerchant = new Map<string, Tx[]>();
  for (const t of spend) {
    const key = normalizeMerchant(t.name).toLowerCase().trim();
    if (!byMerchant.has(key)) byMerchant.set(key, []);
    byMerchant.get(key)!.push(t);
  }

  const out: RecurringCharge[] = [];
  for (const txs of byMerchant.values()) {
    if (txs.length < 3) continue;
    txs.sort((a, b) => a.date.localeCompare(b.date));

    // Steady amount: most charges within 25% of the median.
    const amounts = txs.map((t) => t.amount);
    const mid = median(amounts);
    if (mid <= 0) continue;
    const steady = amounts.filter((a) => Math.abs(a - mid) / mid <= 0.25);
    if (steady.length / amounts.length < 0.7) continue;

    // Steady cadence: median gap lands in a known frequency window.
    const gaps: number[] = [];
    for (let i = 1; i < txs.length; i++) gaps.push(daysBetween(txs[i - 1]!.date, txs[i]!.date));
    const gap = median(gaps);
    const frequency =
      gap >= 5 && gap <= 9
        ? ("weekly" as const)
        : gap >= 12 && gap <= 17
          ? ("biweekly" as const)
          : gap >= 24 && gap <= 38
            ? ("monthly" as const)
            : gap >= 330 && gap <= 400
              ? ("yearly" as const)
              : null;
    if (!frequency) continue;

    const lastDate = txs[txs.length - 1]!.date;
    out.push({
      name: normalizeMerchant(txs[txs.length - 1]!.name),
      avgAmount: round2(mid),
      frequency,
      count: txs.length,
      lastDate,
      nextExpected: addDays(lastDate, Math.round(gap)),
      // Overdue by more than one full cycle = probably cancelled.
      active: daysBetween(lastDate, today) <= gap * 2,
    });
  }
  return out.sort((a, b) => b.avgAmount - a.avgAmount);
}

export async function buildSpendingDashboard(
  db: Db,
  opts: { configured: boolean; linked: boolean; month?: string },
): Promise<SpendingDashboard> {
  const [txs, accountRows] = await Promise.all([
    loadTxs(db),
    db
      .select()
      .from(events)
      .where(and(eq(events.source, "plaid"), eq(events.type, "account"))),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const currentMonth = today.slice(0, 7);
  const months = [...new Set(txs.map((t) => t.month))].sort().reverse();
  const month = opts.month && months.includes(opts.month) ? opts.month : (months[0] ?? currentMonth);

  const spendOf = (ts: Tx[]) =>
    round2(
      ts.reduce((sum, t) => (isSpend(t) ? sum + t.amount : isRefund(t) ? sum + t.amount : sum), 0),
    );
  const incomeOf = (ts: Tx[]) => round2(ts.reduce((s, t) => (isIncome(t) ? s - t.amount : s), 0));

  const inMonth = txs.filter((t) => t.month === month);
  const spend = spendOf(inMonth);
  const refunds = round2(inMonth.filter(isRefund).reduce((s, t) => s - t.amount, 0));

  // Previous calendar month (whether or not it had data).
  const prev = new Date(`${month}-15T12:00:00Z`);
  prev.setUTCMonth(prev.getUTCMonth() - 1);
  const prevMonth = prev.toISOString().slice(0, 7);
  const prevTxs = txs.filter((t) => t.month === prevMonth);
  const prevMonthSpend = prevTxs.length > 0 ? spendOf(prevTxs) : null;

  // Straight-line projection, only meaningful mid-month.
  const dayOfMonth = Number(today.slice(8, 10));
  const daysInMonth = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const projected =
    month === currentMonth && dayOfMonth > 1 ? round2((spend / dayOfMonth) * daysInMonth) : null;

  // Last 12 months, oldest first, for the trend chart.
  const trend = months
    .slice(0, 12)
    .reverse()
    .map((m) => {
      const ts = txs.filter((t) => t.month === m);
      return { month: m, spend: spendOf(ts), income: incomeOf(ts) };
    });

  // Per-day spend + running total across the selected month.
  const byDay = new Map<string, number>();
  for (const t of inMonth) {
    if (isSpend(t) || isRefund(t)) byDay.set(t.date, (byDay.get(t.date) ?? 0) + t.amount);
  }
  let running = 0;
  const daily = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, s]) => {
      running += s;
      return { date, spend: round2(s), cumulative: round2(running) };
    });

  const categories = [
    ...inMonth
      .filter((t) => isSpend(t) || isRefund(t))
      .reduce((m, t) => {
        const key = t.category ?? "OTHER";
        const cur = m.get(key) ?? { spend: 0, count: 0 };
        m.set(key, { spend: cur.spend + t.amount, count: cur.count + 1 });
        return m;
      }, new Map<string, { spend: number; count: number }>())
      .entries(),
  ]
    .map(([category, v]) => ({ category, spend: round2(v.spend), count: v.count }))
    .sort((a, b) => b.spend - a.spend);

  const accounts = accountRows
    .map((r) => {
      const p = (r.payload ?? {}) as AccountPayload;
      const mine = inMonth.filter((t) => t.accountId === r.externalId && isSpend(t));
      return {
        accountId: r.externalId,
        name: r.title ?? "(unnamed account)",
        mask: p.mask ?? null,
        accountType: p.accountType ?? null,
        subtype: p.subtype ?? null,
        balance: p.balanceCurrent ?? null,
        creditLimit: p.creditLimit ?? null,
        spend: round2(mine.reduce((s, t) => s + t.amount, 0)),
        count: mine.length,
      };
    })
    .sort((a, b) => b.spend - a.spend);

  const merchants = [
    ...inMonth
      .filter(isSpend)
      .reduce((m, t) => {
        const key = normalizeMerchant(t.name);
        const cur = m.get(key) ?? { spend: 0, count: 0 };
        m.set(key, { spend: cur.spend + t.amount, count: cur.count + 1 });
        return m;
      }, new Map<string, { spend: number; count: number }>())
      .entries(),
  ]
    .map(([name, v]) => ({ name, spend: round2(v.spend), count: v.count }))
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 10);

  return {
    configured: opts.configured,
    linked: opts.linked,
    month,
    months,
    summary: {
      spend,
      income: incomeOf(inMonth),
      refunds,
      txCount: inMonth.length,
      pendingCount: inMonth.filter((t) => t.pending).length,
      prevMonthSpend,
      projected,
    },
    trend,
    daily,
    categories,
    accounts,
    merchants,
    recurring: detectRecurring(txs.filter(isSpend), today),
    transactions: inMonth
      .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
      .map(({ id, date, name, amount, category, pending, accountId }) => ({
        id,
        date,
        name,
        amount,
        category,
        pending,
        accountId,
      })),
  };
}
