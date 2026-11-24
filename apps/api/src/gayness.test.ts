import { describe, expect, it } from "vitest";
import { scoreGayDay, type DaySignals } from "./gayness";

// Baseline: an ordinary errand day - left the house, did a couple of
// productive things, nothing notable.
const day = (partial: Partial<DaySignals> = {}): DaySignals => ({
  transportation: true,
  productivityUnits: 1,
  delivery: false,
  socialEvent: false,
  journaled: false,
  exercised: false,
  finishedBook: false,
  gayMerchant: false,
  ...partial,
});

describe("scoreGayDay", () => {
  it("floors at 1 - no day is not gay", () => {
    const r = scoreGayDay(day());
    expect(r.score).toBe(1);
    expect(r.label).toBe("gay");
  });

  it("doing nothing at all nets out to gay (homebody offsets the sloth)", () => {
    const r = scoreGayDay(day({ transportation: false, productivityUnits: 0 }));
    expect(r.score).toBe(1);
    expect(r.breakdown).toEqual([
      { rule: "homebody", points: 1 },
      { rule: "zero productivity", points: -1 },
    ]);
  });

  it("grinding is camp: a heavy home commit day is super gay", () => {
    const r = scoreGayDay(day({ transportation: false, productivityUnits: 5 }));
    expect(r.score).toBe(3);
    expect(r.label).toBe("super gay");
    expect(r.breakdown).toEqual([
      { rule: "homebody", points: 1 },
      { rule: "heavy productivity", points: 1 },
    ]);
  });

  it("delivery drags a day down but never below 1", () => {
    expect(scoreGayDay(day({ delivery: true, productivityUnits: 0 })).score).toBe(1);
    const grind = day({ transportation: false, productivityUnits: 5 });
    expect(scoreGayDay(grind).score).toBe(3);
    expect(scoreGayDay({ ...grind, delivery: true }).score).toBe(2);
  });

  it("the full camp maximum: grind + journal + exercise + book + gay merchant", () => {
    const r = scoreGayDay(
      day({
        transportation: false,
        productivityUnits: 5,
        journaled: true,
        exercised: true,
        finishedBook: true,
        gayMerchant: true,
      }),
    );
    expect(r.score).toBe(5);
    expect(r.label).toBe("SUPER MEGA GAY");
  });

  it("going out can also max: social event + gay merchant + grind", () => {
    const r = scoreGayDay(
      day({ productivityUnits: 3, socialEvent: true, gayMerchant: true, journaled: true }),
    );
    // transportation true (went out) so no homebody point: 1 + 4 = 5.
    expect(r.score).toBe(5);
    expect(r.label).toBe("SUPER MEGA GAY");
  });

  it("moderate productivity (1-2 units) is neutral", () => {
    const r = scoreGayDay(day({ productivityUnits: 2, journaled: true }));
    expect(r.score).toBe(2);
    expect(r.breakdown).toEqual([{ rule: "journaled", points: 1 }]);
  });
});
