import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { events, tagRules, tags, type Db } from "@life/db";
import type {
  LoanAssignInput,
  LoanInput,
  LoanMerchant,
  LoanPaymentTx,
  LoanRow,
  LoansResponse,
} from "@life/shared";
import { loadTxs, merchantKeyOf, type Tx } from "./spending";

// Manual loans live in the generic `events` table: source "manual", type
// "loan" (no servicer is linkable through Plaid - Sallie Mae is DOWN/delisted,
// federal servicers broke in 2024). The entered balance is an anchor: the
// remaining balance as of `asOfDate`. From there the API accrues daily simple
// interest and applies matched bank transactions as payments, so the shown
// balance keeps tracking without re-entering it - re-anchor (edit the balance
// + as-of date) whenever a statement shows drift.
//
// Loans link to *merchants*, not individual transactions: `merchantKeys` in
// the payload holds normalized merchant keys (same content-not-ids rule as
// recurring series and tag rules, so links survive the Plaid re-link wipe),
// and every charge from a linked merchant - past and future - counts as a
// payment automatically. Charges on or before the anchor date are excluded;
// the anchor balance already reflects them.

type LoanPayload = {
  balance: number;
  asOfDate: string;
  interestRate: number | null;
  minimumPayment: number | null;
  originalPrincipal: number | null;
  dueDay: number | null;
  lender: string | null;
  merchantKeys: string[];
};

const DAY_MS = 86_400_000;
const daysBetween = (a: string, b: string) =>
  Math.max(0, Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS));
const round2 = (n: number) => Math.round(n * 100) / 100;

export type LoanProjection = {
  currentBalance: number;
  accruedInterest: number; // unpaid accrued interest included in currentBalance
  totalPaid: number;
  series: { date: string; value: number }[];
};

// Walk the balance forward from the anchor: daily simple interest accrues on
// principal (student-loan style - unpaid interest doesn't compound), each
// payment pays accrued interest first, the remainder reduces principal.
// Payments on or before the anchor date are ignored - the anchor balance
// already reflects them. `today` is a parameter for determinism (tests).
export function projectLoan(opts: {
  balance: number;
  asOfDate: string;
  annualRatePct: number | null;
  payments: { date: string; amount: number }[];
  today: string;
}): LoanProjection {
  const dailyRate = (opts.annualRatePct ?? 0) / 100 / 365;
  const applicable = opts.payments
    .filter((p) => p.date > opts.asOfDate && p.date <= opts.today && p.amount > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  let principal = opts.balance;
  let accrued = 0;
  let cursor = opts.asOfDate;
  let totalPaid = 0;
  const series: { date: string; value: number }[] = [
    { date: opts.asOfDate, value: round2(opts.balance) },
  ];

  const accrueTo = (date: string) => {
    accrued += principal * dailyRate * daysBetween(cursor, date);
    cursor = date;
  };

  for (const p of applicable) {
    accrueTo(p.date);
    const interestPart = Math.min(p.amount, accrued);
    accrued -= interestPart;
    principal = Math.max(0, principal - (p.amount - interestPart));
    totalPaid += p.amount;
    series.push({ date: p.date, value: round2(principal + accrued) });
  }
  if (cursor < opts.today) {
    accrueTo(opts.today);
    series.push({ date: opts.today, value: round2(principal + accrued) });
  }

  return {
    currentBalance: round2(principal + accrued),
    accruedInterest: round2(accrued),
    totalPaid: round2(totalPaid),
    series,
  };
}

// Forward amortization from the current state: the monthly payment lands on
// each due day (same interest-first split as projectLoan) until the balance
// clears. Returns the payoff date and the total interest still to be paid
// (accrued-but-unpaid interest included - it gets paid too). Null when
// there's no payment set, or the payment doesn't outrun interest within 50
// years. Assumes rate and payment stay fixed - an estimate, not a schedule.
export function projectPayoff(opts: {
  principal: number;
  accruedInterest: number;
  annualRatePct: number | null;
  monthlyPayment: number | null;
  dueDay: number | null;
  today: string;
}): { payoffDate: string | null; totalInterest: number | null } {
  if (opts.principal + opts.accruedInterest <= 0) {
    return { payoffDate: opts.today, totalInterest: 0 };
  }
  const payment = opts.monthlyPayment ?? 0;
  if (payment <= 0) return { payoffDate: null, totalInterest: null };
  const dailyRate = (opts.annualRatePct ?? 0) / 100 / 365;
  const [ty, tm, td] = opts.today.split("-").map(Number) as [number, number, number];
  const day = opts.dueDay ?? td; // no due day set -> pay on today's day-of-month
  const dateFor = (yy: number, mm: number) => {
    const lastDay = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
    return new Date(Date.UTC(yy, mm, Math.min(day, lastDay))).toISOString().slice(0, 10);
  };

  let principal = opts.principal;
  let accrued = opts.accruedInterest;
  let totalInterest = opts.accruedInterest;
  let cursor = opts.today;
  let month = tm - 1; // JS month index; Date.UTC normalizes overflow
  if (dateFor(ty, month) < opts.today) month += 1;
  for (let i = 0; i < 600; i++, month++) {
    const payDate = dateFor(ty, month);
    const accrual = principal * dailyRate * daysBetween(cursor, payDate);
    accrued += accrual;
    totalInterest += accrual;
    cursor = payDate;
    const interestPart = Math.min(payment, accrued);
    accrued -= interestPart;
    principal = Math.max(0, principal - (payment - interestPart));
    if (principal + accrued <= 0.005) {
      return { payoffDate: payDate, totalInterest: round2(totalInterest) };
    }
  }
  return { payoffDate: null, totalInterest: null };
}

// Next occurrence of a monthly due day, on or after `today`. Days past the end
// of a month clamp to that month's last day (due-day 31 in September -> the
// 30th), matching how servicers roll short months.
export function nextDueDate(dueDay: number | null, today: string): string | null {
  if (dueDay == null) return null;
  const [y, m] = today.split("-").map(Number) as [number, number, ...number[]];
  for (const monthOffset of [0, 1]) {
    const month = m - 1 + monthOffset;
    const lastDay = new Date(Date.UTC(y, month + 1, 0)).getUTCDate();
    const d = new Date(Date.UTC(y, month, Math.min(dueDay, lastDay)));
    const iso = d.toISOString().slice(0, 10);
    if (iso >= today) return iso;
  }
  return null; // unreachable: next month's due day is always in the future
}

function payloadOf(row: typeof events.$inferSelect): LoanPayload {
  const p = (row.payload ?? {}) as Partial<LoanPayload>;
  return {
    balance: p.balance ?? 0,
    asOfDate: p.asOfDate ?? row.createdAt.toISOString().slice(0, 10),
    interestRate: p.interestRate ?? null,
    minimumPayment: p.minimumPayment ?? null,
    originalPrincipal: p.originalPrincipal ?? null,
    dueDay: p.dueDay ?? null,
    lender: p.lender ?? null,
    merchantKeys: p.merchantKeys ?? [],
  };
}

function inputToPayload(input: LoanInput, merchantKeys: string[]): LoanPayload {
  return {
    balance: input.balance,
    asOfDate: input.asOfDate,
    interestRate: input.interestRate ?? null,
    minimumPayment: input.minimumPayment ?? null,
    originalPrincipal: input.originalPrincipal ?? null,
    dueDay: input.dueDay ?? null,
    lender: input.lender ?? null,
    merchantKeys,
  };
}

const loanWhere = (id?: number) =>
  id == null
    ? and(eq(events.source, "manual"), eq(events.type, "loan"))
    : and(eq(events.id, id), eq(events.source, "manual"), eq(events.type, "loan"));

export async function createLoan(db: Db, input: LoanInput) {
  const row = (
    await db
      .insert(events)
      .values({
        source: "manual",
        externalId: randomUUID(),
        type: "loan",
        title: input.name,
        startTs: new Date(`${input.asOfDate}T12:00:00Z`),
        payload: inputToPayload(input, []),
      })
      .returning()
  )[0]!;
  return { id: row.id };
}

// Full-replace edit (the form resubmits every field; omitted optionals clear)
// - except merchantKeys, which the assign endpoint owns and an edit preserves.
export async function updateLoan(db: Db, id: number, input: LoanInput): Promise<boolean> {
  const existing = await db.select().from(events).where(loanWhere(id));
  if (!existing[0]) return false;
  await db
    .update(events)
    .set({
      title: input.name,
      startTs: new Date(`${input.asOfDate}T12:00:00Z`),
      payload: inputToPayload(input, payloadOf(existing[0]).merchantKeys),
      updatedAt: new Date(),
    })
    .where(loanWhere(id));
  return true;
}

export async function deleteLoan(db: Db, id: number): Promise<boolean> {
  const deleted = await db.delete(events).where(loanWhere(id)).returning({ id: events.id });
  return deleted.length > 0;
}

// Link (loanId set) or unlink (loanId null) a merchant stream. The key is
// stripped from every loan first, so assigning also moves a merchant between
// loans in one call - a merchant pays at most one loan.
export async function assignLoanMerchant(db: Db, input: LoanAssignInput): Promise<boolean> {
  const key = input.merchantKey;
  const rows = await db.select().from(events).where(loanWhere());
  let targetSeen = input.loanId == null;
  for (const row of rows) {
    const payload = payloadOf(row);
    const has = payload.merchantKeys.includes(key);
    const isTarget = row.id === input.loanId;
    if (isTarget) targetSeen = true;
    if (has === isTarget) continue;
    const merchantKeys = isTarget
      ? [...payload.merchantKeys, key]
      : payload.merchantKeys.filter((k) => k !== key);
    await db
      .update(events)
      .set({ payload: { ...payload, merchantKeys }, updatedAt: new Date() })
      .where(loanWhere(row.id));
  }
  return targetSeen;
}

const toPaymentTx = (t: Tx): LoanPaymentTx => ({
  date: t.date,
  amount: t.amount,
  merchantKey: merchantKeyOf(t.name),
  name: t.name,
});

// Whole-history summary of one merchant's charge stream (for the linked chips
// and the unlinked pool). Charges sorted date desc on the way in.
function merchantSummary(key: string, charges: Tx[]): LoanMerchant {
  const latest = charges[0];
  return {
    merchantKey: key,
    name: latest?.name ?? key,
    count: charges.length,
    total: round2(charges.reduce((sum, t) => sum + t.amount, 0)),
    lastDate: latest?.date ?? null,
    lastAmount: latest?.amount ?? null,
  };
}

// The Loans page's whole read: every loan with its projection + payments
// matched from its linked merchants, plus the pool of student-loan-tagged
// merchants not linked anywhere (the tag is looked up by name; no tag ->
// empty pool).
export async function buildLoansResponse(db: Db, today: string): Promise<LoansResponse> {
  const [rows, txs, allTags] = await Promise.all([
    db.select().from(events).where(loanWhere()),
    loadTxs(db),
    db.select().from(tags),
  ]);

  // Charges (money out only) grouped per merchant stream, newest first.
  const chargesByMerchant = new Map<string, Tx[]>();
  for (const t of txs) {
    if (t.amount <= 0) continue;
    const key = merchantKeyOf(t.name);
    chargesByMerchant.set(key, [...(chargesByMerchant.get(key) ?? []), t]);
  }
  for (const list of chargesByMerchant.values())
    list.sort((a, b) => b.date.localeCompare(a.date));

  const linkedMerchants = new Set<string>();
  const loans: LoanRow[] = rows
    .map((row) => {
      const p = payloadOf(row);
      for (const key of p.merchantKeys) linkedMerchants.add(key);
      // Every charge from a linked merchant after the anchor date counts.
      const paymentTxs = p.merchantKeys
        .flatMap((key) => chargesByMerchant.get(key) ?? [])
        .filter((t) => t.date > p.asOfDate)
        .map(toPaymentTx)
        .sort((a, b) => b.date.localeCompare(a.date));
      const projection = projectLoan({
        balance: p.balance,
        asOfDate: p.asOfDate,
        annualRatePct: p.interestRate,
        payments: paymentTxs,
        today,
      });
      const payoff = projectPayoff({
        principal: projection.currentBalance - projection.accruedInterest,
        accruedInterest: projection.accruedInterest,
        annualRatePct: p.interestRate,
        monthlyPayment: p.minimumPayment,
        dueDay: p.dueDay,
        today,
      });
      return {
        id: row.id,
        name: row.title ?? "(unnamed)",
        balance: p.balance,
        asOfDate: p.asOfDate,
        interestRate: p.interestRate,
        minimumPayment: p.minimumPayment,
        originalPrincipal: p.originalPrincipal,
        dueDay: p.dueDay,
        lender: p.lender,
        createdAt: row.createdAt.toISOString(),
        currentBalance: projection.currentBalance,
        accruedInterest: projection.accruedInterest,
        totalPaid: projection.totalPaid,
        nextDueDate: nextDueDate(p.dueDay, today),
        payoffDate: payoff.payoffDate,
        projectedInterest: payoff.totalInterest,
        merchants: p.merchantKeys.map((key) =>
          merchantSummary(key, chargesByMerchant.get(key) ?? []),
        ),
        payments: paymentTxs,
        series: projection.series,
      };
    })
    .sort((a, b) => b.currentBalance - a.currentBalance);

  // Linkable pool: merchants carrying the student-loan tag, minus merchants
  // already linked to a loan. Name-matched tolerantly ("student-loan",
  // "student loans", ...) so a rename doesn't silently empty the pool.
  const isStudentLoanTag = (name: string) =>
    name.trim().toLowerCase().replace(/[^a-z]/g, "").replace(/s$/, "") === "studentloan";
  const loanTag = allTags.find((t) => isStudentLoanTag(t.name));
  const taggedRules = loanTag
    ? await db.select().from(tagRules).where(eq(tagRules.tagId, loanTag.id))
    : [];
  const unassigned = taggedRules
    .map((r) => r.merchantKey)
    .filter((key) => !linkedMerchants.has(key))
    .map((key) => merchantSummary(key, chargesByMerchant.get(key) ?? []))
    .filter((m) => m.count > 0)
    .sort((a, b) => (b.lastDate ?? "").localeCompare(a.lastDate ?? ""));

  return {
    loans,
    unassigned,
    totals: {
      balance: round2(loans.reduce((sum, l) => sum + l.currentBalance, 0)),
      minimumPayment: round2(loans.reduce((sum, l) => sum + (l.minimumPayment ?? 0), 0)),
    },
  };
}
