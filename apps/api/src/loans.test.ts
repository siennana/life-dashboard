import { describe, expect, it } from "vitest";
import { nextDueDate, projectLoan, projectPayoff } from "./loans";

describe("projectLoan", () => {
  it("holds the anchor balance with no rate and no payments", () => {
    const p = projectLoan({
      balance: 5000,
      asOfDate: "2026-01-01",
      annualRatePct: null,
      payments: [],
      today: "2026-06-01",
    });
    expect(p.currentBalance).toBe(5000);
    expect(p.accruedInterest).toBe(0);
    expect(p.totalPaid).toBe(0);
    expect(p.series).toEqual([
      { date: "2026-01-01", value: 5000 },
      { date: "2026-06-01", value: 5000 },
    ]);
  });

  it("accrues daily simple interest on principal", () => {
    // 3.65% APR -> 0.01% daily; 10000 for 100 days -> exactly 100 interest.
    const p = projectLoan({
      balance: 10_000,
      asOfDate: "2026-01-01",
      annualRatePct: 3.65,
      payments: [],
      today: "2026-04-11", // 100 days later
    });
    expect(p.currentBalance).toBe(10_100);
    expect(p.accruedInterest).toBe(100);
  });

  it("applies payments to accrued interest first, then principal", () => {
    const p = projectLoan({
      balance: 10_000,
      asOfDate: "2026-01-01",
      annualRatePct: 3.65,
      payments: [{ date: "2026-04-11", amount: 150 }], // 100 accrued by then
      today: "2026-04-11",
    });
    // 100 interest paid, 50 principal -> 9950, no accrued left.
    expect(p.currentBalance).toBe(9950);
    expect(p.accruedInterest).toBe(0);
    expect(p.totalPaid).toBe(150);
  });

  it("accrues on the reduced principal after a payment", () => {
    const p = projectLoan({
      balance: 10_000,
      asOfDate: "2026-01-01",
      annualRatePct: 3.65,
      payments: [{ date: "2026-04-11", amount: 150 }],
      today: "2026-07-20", // 100 more days on 9950 -> +99.50
    });
    expect(p.currentBalance).toBe(10_049.5);
    expect(p.accruedInterest).toBe(99.5);
  });

  it("carries unpaid interest when a payment doesn't cover it", () => {
    const p = projectLoan({
      balance: 10_000,
      asOfDate: "2026-01-01",
      annualRatePct: 3.65,
      payments: [{ date: "2026-04-11", amount: 60 }], // 100 accrued, 40 remains
      today: "2026-04-11",
    });
    expect(p.currentBalance).toBe(10_040);
    expect(p.accruedInterest).toBe(40);
  });

  it("ignores payments on or before the anchor date (already in the balance)", () => {
    const p = projectLoan({
      balance: 5000,
      asOfDate: "2026-03-15",
      annualRatePct: null,
      payments: [
        { date: "2026-03-01", amount: 200 },
        { date: "2026-03-15", amount: 200 },
      ],
      today: "2026-04-01",
    });
    expect(p.currentBalance).toBe(5000);
    expect(p.totalPaid).toBe(0);
  });

  it("ignores refunds and future-dated payments", () => {
    const p = projectLoan({
      balance: 5000,
      asOfDate: "2026-01-01",
      annualRatePct: null,
      payments: [
        { date: "2026-02-01", amount: -100 },
        { date: "2027-01-01", amount: 100 },
      ],
      today: "2026-06-01",
    });
    expect(p.currentBalance).toBe(5000);
    expect(p.totalPaid).toBe(0);
  });

  it("clamps an overpayment to zero instead of going negative", () => {
    const p = projectLoan({
      balance: 100,
      asOfDate: "2026-01-01",
      annualRatePct: null,
      payments: [{ date: "2026-02-01", amount: 500 }],
      today: "2026-03-01",
    });
    expect(p.currentBalance).toBe(0);
  });

  it("emits a series point at the anchor, each payment, and today", () => {
    const p = projectLoan({
      balance: 1000,
      asOfDate: "2026-01-01",
      annualRatePct: null,
      payments: [
        { date: "2026-02-01", amount: 100 },
        { date: "2026-03-01", amount: 100 },
      ],
      today: "2026-04-01",
    });
    expect(p.series.map((s) => s.date)).toEqual([
      "2026-01-01",
      "2026-02-01",
      "2026-03-01",
      "2026-04-01",
    ]);
    expect(p.series.map((s) => s.value)).toEqual([1000, 900, 800, 800]);
  });
});

describe("projectPayoff", () => {
  const base = {
    principal: 1000,
    accruedInterest: 0,
    annualRatePct: null as number | null,
    monthlyPayment: 100 as number | null,
    dueDay: 1 as number | null,
    today: "2026-01-15",
  };

  it("returns null without a monthly payment", () => {
    expect(projectPayoff({ ...base, monthlyPayment: null })).toEqual({
      payoffDate: null,
      totalInterest: null,
    });
  });

  it("pays off a zero-rate loan in balance/payment months, zero interest", () => {
    // 1000 / 100 = 10 payments: Feb 1 2026 .. Nov 1 2026.
    const p = projectPayoff(base);
    expect(p).toEqual({ payoffDate: "2026-11-01", totalInterest: 0 });
  });

  it("accrues daily interest between payments and counts it", () => {
    // 3.65% -> 0.01%/day. Jan 11: 10 days on 1000 = 1.00 interest, 599 to
    // principal (401 left). Feb 11: 31 days on 401 = 1.2431 interest; 600
    // covers the remaining 402.24 -> paid off. Total interest 2.24.
    const p = projectPayoff({
      ...base,
      annualRatePct: 3.65,
      monthlyPayment: 600,
      dueDay: 11,
      today: "2026-01-01",
    });
    expect(p.payoffDate).toBe("2026-02-11");
    expect(p.totalInterest).toBe(2.24);
  });

  it("counts already-accrued unpaid interest toward the total", () => {
    const p = projectPayoff({ ...base, accruedInterest: 5, monthlyPayment: 1005 });
    expect(p.payoffDate).toBe("2026-02-01");
    expect(p.totalInterest).toBe(5);
  });

  it("returns null when the payment never outruns interest", () => {
    // 10% of 10000 is ~83/month in interest; a $50 payment diverges.
    const p = projectPayoff({
      ...base,
      principal: 10_000,
      annualRatePct: 10,
      monthlyPayment: 50,
    });
    expect(p).toEqual({ payoffDate: null, totalInterest: null });
  });

  it("treats an already-cleared balance as paid off today", () => {
    expect(projectPayoff({ ...base, principal: 0 })).toEqual({
      payoffDate: "2026-01-15",
      totalInterest: 0,
    });
  });

  it("falls back to today's day-of-month without a due day", () => {
    const p = projectPayoff({ ...base, dueDay: null, monthlyPayment: 1000 });
    expect(p.payoffDate).toBe("2026-01-15"); // due today, pays off immediately
  });
});

describe("nextDueDate", () => {
  it("returns null without a due day", () => {
    expect(nextDueDate(null, "2026-09-14")).toBeNull();
  });

  it("uses this month when the due day is still ahead (or today)", () => {
    expect(nextDueDate(20, "2026-09-14")).toBe("2026-09-20");
    expect(nextDueDate(14, "2026-09-14")).toBe("2026-09-14");
  });

  it("rolls to next month once the due day has passed", () => {
    expect(nextDueDate(5, "2026-09-14")).toBe("2026-10-05");
  });

  it("clamps due days past the end of a month", () => {
    expect(nextDueDate(31, "2026-09-14")).toBe("2026-09-30");
    expect(nextDueDate(31, "2026-02-01")).toBe("2026-02-28");
  });

  it("rolls across the year boundary", () => {
    expect(nextDueDate(5, "2026-12-10")).toBe("2027-01-05");
  });
});
