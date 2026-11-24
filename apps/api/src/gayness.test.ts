import { describe, expect, it } from "vitest";
import { scoreGayDay, type DaySignals } from "./gayness";

// Baseline: an ordinary errand day - left the house, did a couple of
// productive things, nothing notable.
const day = (partial: Partial<DaySignals> = {}): DaySignals => ({
  transportation: true,
  productivityUnits: 1,
  streaming: false,
  delivery: false,
  socialEvent: false,
  journaled: false,
  exercised: false,
  finishedBook: false,
  gayMerchant: false,
  loanPayment: false,
  ...partial,
});

describe("scoreGayDay", () => {
  it("floors at 1 - no day is not gay", () => {
    const r = scoreGayDay(day());
    expect(r.score).toBe(1);
    expect(r.label).toBe("gay");
  });

  it("doing nothing at all is super gay (the canonical spec)", () => {
    const r = scoreGayDay(day({ transportation: false, productivityUnits: 0 }));
    expect(r.score).toBe(3);
    expect(r.label).toBe("super gay");
    expect(r.breakdown).toEqual([
      { rule: "homebody", points: 1 },
      { rule: "zero productivity", points: 1 },
    ]);
  });

  it("doing nothing plus streaming is exceptionally gay", () => {
    const r = scoreGayDay(day({ transportation: false, productivityUnits: 0, streaming: true }));
    expect(r.score).toBe(4);
    expect(r.label).toBe("exceptionally gay");
  });

  it("couch + delivery + streaming maxes out, in caps", () => {
    const r = scoreGayDay(
      day({ transportation: false, productivityUnits: 0, streaming: true, delivery: true }),
    );
    expect(r.score).toBe(5);
    expect(r.label).toBe("SUPER MEGA GAY");
  });

  it("clamps at 5 even when every positive rule fires", () => {
    const r = scoreGayDay(
      day({
        transportation: false,
        productivityUnits: 0,
        streaming: true,
        delivery: true,
        socialEvent: true,
        journaled: true,
        exercised: true,
        finishedBook: true,
        gayMerchant: true,
      }),
    );
    expect(r.score).toBe(5);
  });

  it("heavy productivity drags the day down but never below 1", () => {
    const r = scoreGayDay(day({ productivityUnits: 5 }));
    expect(r.score).toBe(1);
    expect(r.breakdown).toEqual([{ rule: "heavy productivity", points: -1 }]);
  });

  it("a student loan payment knocks off a tier", () => {
    const base = day({ transportation: false, productivityUnits: 0, streaming: true });
    expect(scoreGayDay(base).score).toBe(4);
    expect(scoreGayDay({ ...base, loanPayment: true }).score).toBe(3);
  });

  it("going out can also max: social event + gay merchant + no productivity", () => {
    const r = scoreGayDay(
      day({ productivityUnits: 0, socialEvent: true, gayMerchant: true, delivery: true }),
    );
    // transportation true (went out), so no homebody point: 1 + 4 = 5.
    expect(r.score).toBe(5);
    expect(r.label).toBe("SUPER MEGA GAY");
  });

  it("moderate productivity (1-2 units) is neutral", () => {
    const r = scoreGayDay(day({ productivityUnits: 2, journaled: true }));
    expect(r.score).toBe(2);
    expect(r.breakdown).toEqual([{ rule: "journaled", points: 1 }]);
  });
});
