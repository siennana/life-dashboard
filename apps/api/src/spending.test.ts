import { describe, expect, it } from "vitest";
import {
  buildRecurringSection,
  detectRecurring,
  isIncome,
  isRefund,
  isSpend,
  matchesSeries,
  merchantKeyOf,
  normalizeMerchant,
  type SeriesRow,
  type Tx,
} from "./spending";

// Pure-logic tests for the money math everything on the Bank page + calendar
// cashflow rests on. No DB, no network - Tx/SeriesRow rows are built by hand
// and `today` is always passed explicitly so results are deterministic.

let nextId = 1;
function tx(partial: Partial<Tx> & { date: string; amount: number }): Tx {
  return {
    id: nextId++,
    month: partial.date.slice(0, 7),
    name: "Merchant",
    pending: false,
    accountId: null,
    category: null,
    detailed: null,
    ...partial,
  };
}

function series(partial: Partial<SeriesRow>): SeriesRow {
  return {
    id: nextId++,
    merchant: "Netflix",
    merchantKey: "netflix",
    amount: "8.99",
    frequency: "monthly",
    status: "confirmed",
    expiresOn: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...partial,
  };
}

// Evenly spaced charges (gapDays apart) ending just before `today`.
function chargeRun(opts: {
  name: string;
  amount: number | number[];
  gapDays: number;
  count: number;
  last: string; // YYYY-MM-DD of the final charge
}): Tx[] {
  const lastMs = Date.parse(opts.last);
  return Array.from({ length: opts.count }, (_, i) => {
    const idx = opts.count - 1 - i; // charges back from `last`
    const date = new Date(lastMs - idx * opts.gapDays * 86_400_000).toISOString().slice(0, 10);
    const amount = Array.isArray(opts.amount) ? opts.amount[opts.count - 1 - idx]! : opts.amount;
    return tx({ date, amount, name: opts.name });
  });
}

describe("normalizeMerchant / merchantKeyOf", () => {
  it("collapses statement descriptors to brands", () => {
    expect(normalizeMerchant("Chidoordash.comca")).toBe("DoorDash");
    expect(normalizeMerchant("AMZN Mktp US*123")).toBe("Amazon");
  });

  it("orders needles so specific brands win (uber eats before uber)", () => {
    expect(normalizeMerchant("UBER EATS PENDING")).toBe("Uber Eats");
    expect(normalizeMerchant("UBER *TRIP")).toBe("Uber");
    expect(normalizeMerchant("Amazon Prime*2V4")).toBe("Amazon Prime");
  });

  it("passes unknown merchants through untouched", () => {
    expect(normalizeMerchant("Sallie Mae")).toBe("Sallie Mae");
  });

  it("keys are lowercased + trimmed", () => {
    expect(merchantKeyOf("  Sallie Mae ")).toBe("sallie mae");
    expect(merchantKeyOf("CHIDOORDASH.COMCA")).toBe("doordash");
  });
});

describe("spend classification", () => {
  it("positive amounts are spend unless internally categorized", () => {
    expect(isSpend(tx({ date: "2026-08-01", amount: 20 }))).toBe(true);
    for (const detailed of [
      "TRANSFER_OUT_ACCOUNT_TRANSFER",
      "TRANSFER_OUT_SAVINGS",
      "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
      "LOAN_PAYMENTS_OTHER_PAYMENT", // US Bank's card-payment label
    ]) {
      expect(isSpend(tx({ date: "2026-08-01", amount: 20, detailed }))).toBe(false);
    }
    // Real external payments still count even under a loan-ish category.
    expect(
      isSpend(tx({ date: "2026-08-01", amount: 341, detailed: "LOAN_PAYMENTS_STUDENT_LOAN" })),
    ).toBe(true);
  });

  it("negative amounts split into refund vs income vs internal transfer-in", () => {
    const refund = tx({ date: "2026-08-01", amount: -15 });
    const paycheck = tx({ date: "2026-08-01", amount: -2000, category: "INCOME" });
    const transferIn = tx({
      date: "2026-08-01",
      amount: -500,
      detailed: "TRANSFER_IN_ACCOUNT_TRANSFER",
    });
    expect(isRefund(refund)).toBe(true);
    expect(isIncome(refund)).toBe(false);
    expect(isIncome(paycheck)).toBe(true);
    expect(isRefund(paycheck)).toBe(false);
    expect(isRefund(transferIn)).toBe(false);
    expect(isIncome(transferIn)).toBe(false);
    // Spend is never negative-amount.
    expect(isSpend(refund)).toBe(false);
  });
});

describe("detectRecurring", () => {
  const TODAY = "2026-08-10";

  it("detects a steady monthly charge with cadence + next-expected", () => {
    const txs = chargeRun({ name: "Netflix", amount: 8.99, gapDays: 30, count: 4, last: "2026-08-01" });
    const [hit] = detectRecurring(txs, TODAY, new Set());
    expect(hit).toBeDefined();
    expect(hit!.frequency).toBe("monthly");
    expect(hit!.avgAmount).toBe(8.99);
    expect(hit!.count).toBe(4);
    expect(hit!.lastDate).toBe("2026-08-01");
    expect(hit!.nextExpected).toBe("2026-08-31");
    expect(hit!.active).toBe(true);
  });

  it("maps gap medians to the right frequency windows", () => {
    const cases: [number, string][] = [
      [7, "weekly"],
      [14, "biweekly"],
      [30, "monthly"],
      [365, "yearly"],
    ];
    for (const [gap, freq] of cases) {
      const txs = chargeRun({ name: "X", amount: 50, gapDays: gap, count: 4, last: "2026-08-01" });
      expect(detectRecurring(txs, TODAY, new Set())[0]?.frequency).toBe(freq);
    }
    // A gap in no window (e.g. ~45d) is not recurring.
    const odd = chargeRun({ name: "X", amount: 50, gapDays: 45, count: 4, last: "2026-08-01" });
    expect(detectRecurring(odd, TODAY, new Set())).toHaveLength(0);
  });

  it("needs at least 3 charges and a steady amount", () => {
    const two = chargeRun({ name: "X", amount: 50, gapDays: 30, count: 2, last: "2026-08-01" });
    expect(detectRecurring(two, TODAY, new Set())).toHaveLength(0);
    // Most amounts far off the median -> not steady -> not recurring.
    const wild = chargeRun({
      name: "X",
      amount: [10, 100, 55, 300],
      gapDays: 30,
      count: 4,
      last: "2026-08-01",
    });
    expect(detectRecurring(wild, TODAY, new Set())).toHaveLength(0);
  });

  it("groups by normalized merchant and honors excludeKeys", () => {
    const txs = chargeRun({
      name: "Chidoordash.comca", // normalizes to DoorDash
      amount: 25,
      gapDays: 7,
      count: 4,
      last: "2026-08-08",
    });
    const [hit] = detectRecurring(txs, TODAY, new Set());
    expect(hit!.name).toBe("DoorDash");
    expect(hit!.merchantKey).toBe("doordash");
    expect(detectRecurring(txs, TODAY, new Set(["doordash"]))).toHaveLength(0);
  });

  it("flags a series overdue by more than two cycles as inactive", () => {
    const lapsed = chargeRun({ name: "Gym", amount: 40, gapDays: 30, count: 4, last: "2026-05-01" });
    const [hit] = detectRecurring(lapsed, TODAY, new Set());
    expect(hit!.active).toBe(false);
  });
});

describe("matchesSeries", () => {
  it("requires merchant, spend classification, and amount within 25%", () => {
    const netflix = (amount: number, extra: Partial<Tx> = {}) =>
      tx({ date: "2026-08-01", amount, name: "Netflix", ...extra });
    expect(matchesSeries(netflix(8.99), "netflix", 8.99)).toBe(true);
    expect(matchesSeries(netflix(10.5), "netflix", 8.99)).toBe(true); // within 25%
    expect(matchesSeries(netflix(50), "netflix", 8.99)).toBe(false); // gift card
    expect(matchesSeries(netflix(-8.99), "netflix", 8.99)).toBe(false); // refund
    expect(matchesSeries(netflix(8.99, { name: "Spotify" }), "netflix", 8.99)).toBe(false);
    expect(
      matchesSeries(netflix(8.99, { detailed: "TRANSFER_OUT_ACCOUNT_TRANSFER" }), "netflix", 8.99),
    ).toBe(false);
  });
});

describe("buildRecurringSection", () => {
  const TODAY = "2026-08-10";
  // Live monthly + annual + weekly series, all charged recently.
  const txs = [
    ...chargeRun({ name: "Netflix", amount: 8.99, gapDays: 30, count: 4, last: "2026-08-01" }),
    ...chargeRun({ name: "Landlord", amount: 1800, gapDays: 30, count: 4, last: "2026-08-01" }),
    ...chargeRun({ name: "Amazon Prime", amount: 139, gapDays: 365, count: 2, last: "2026-03-01" }),
    ...chargeRun({ name: "Coffee Club", amount: 10, gapDays: 7, count: 5, last: "2026-08-08" }),
  ];
  const rows = [
    series({ id: 1, merchant: "Netflix", merchantKey: "netflix", amount: "8.99" }),
    series({ id: 2, merchant: "Landlord", merchantKey: "landlord", amount: "1800" }),
    series({ id: 3, merchant: "Amazon Prime", merchantKey: "amazon prime", amount: "139", frequency: "yearly" }),
    series({ id: 4, merchant: "Coffee Club", merchantKey: "coffee club", amount: "10", frequency: "weekly" }),
  ];

  it("computes per-frequency totals; annual is annual-billed only, not monthly x12", () => {
    const { totals } = buildRecurringSection(txs, rows, TODAY);
    expect(totals.monthlyTotal).toBe(1808.99); // Netflix + rent
    expect(totals.monthlyCount).toBe(2);
    expect(totals.yearlyTotal).toBe(139); // Prime alone
    expect(totals.yearlyCount).toBe(1);
    // weekly x52 + monthly x12 + yearly x1
    expect(totals.annualizedTotal).toBeCloseTo(10 * 52 + 1808.99 * 12 + 139, 2);
  });

  it("excludes lapsed (inactive) series from totals", () => {
    const lapsed = [
      ...chargeRun({ name: "Gym", amount: 40, gapDays: 30, count: 3, last: "2026-04-01" }),
    ];
    const { confirmed, totals } = buildRecurringSection(
      lapsed,
      [series({ id: 9, merchant: "Gym", merchantKey: "gym", amount: "40" })],
      TODAY,
    );
    expect(confirmed[0]!.active).toBe(false);
    expect(totals.monthlyTotal).toBe(0);
    expect(totals.annualizedTotal).toBe(0);
  });

  it("removes confirmed/dismissed merchants from suggestions; dismissed are restorable stubs", () => {
    const { suggested, dismissed } = buildRecurringSection(
      txs,
      [
        rows[0]!, // Netflix confirmed
        series({ id: 8, merchant: "Coffee Club", merchantKey: "coffee club", status: "dismissed" }),
      ],
      TODAY,
    );
    const names = suggested.map((s) => s.name);
    expect(names).not.toContain("Netflix");
    expect(names).not.toContain("Coffee Club");
    expect(names).toContain("Landlord"); // still just a suggestion
    expect(dismissed).toEqual([{ id: 8, name: "Coffee Club", frequency: "monthly" }]);
  });

  it("confirmed stats come from matched history (amount band filters gift cards)", () => {
    const withGift = [...txs, tx({ date: "2026-08-05", amount: 50, name: "Netflix" })];
    const { confirmed } = buildRecurringSection(withGift, [rows[0]!], TODAY);
    const netflix = confirmed.find((c) => c.name === "Netflix")!;
    expect(netflix.count).toBe(4); // gift card not counted
    expect(netflix.lastDate).toBe("2026-08-01");
    expect(netflix.nextExpected).toBe("2026-08-31");
  });

  it("flags a series still charging past its expiration, not one that stopped", () => {
    const expiredRow = series({ id: 1, expiresOn: "2026-07-15" }); // last charge Aug 1 > Jul 15
    const { confirmed } = buildRecurringSection(txs, [expiredRow], TODAY);
    expect(confirmed[0]!.expired).toBe(true);

    const futureRow = series({ id: 1, expiresOn: "2026-12-31" }); // not yet reached
    expect(buildRecurringSection(txs, [futureRow], TODAY).confirmed[0]!.expired).toBe(false);

    const indefinite = series({ id: 1, expiresOn: null });
    expect(buildRecurringSection(txs, [indefinite], TODAY).confirmed[0]!.expired).toBe(false);
  });
});
