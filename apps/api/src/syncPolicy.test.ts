import { describe, expect, it } from "vitest";
import { shouldSync } from "./syncPolicy";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const now = 1_000 * HOUR; // arbitrary fixed point

const base = { now, activityWindowMs: 10 * MIN, catchupAfterMs: 24 * HOUR };

describe("shouldSync", () => {
  it("auto always runs, manual never does", () => {
    expect(shouldSync({ ...base, mode: "auto", lastActivityAt: null, lastCycleAt: null })).toBe(true);
    expect(
      shouldSync({ ...base, mode: "manual", lastActivityAt: now, lastCycleAt: null }),
    ).toBe(false);
  });

  it("active: runs while the site was used inside the window", () => {
    expect(
      shouldSync({ ...base, mode: "active", lastActivityAt: now - 9 * MIN, lastCycleAt: now - MIN }),
    ).toBe(true);
    expect(
      shouldSync({ ...base, mode: "active", lastActivityAt: now - 10 * MIN, lastCycleAt: now - MIN }),
    ).toBe(true); // boundary is inclusive
  });

  it("active: idle past the window stops syncing", () => {
    expect(
      shouldSync({
        ...base,
        mode: "active",
        lastActivityAt: now - 11 * MIN,
        lastCycleAt: now - 5 * MIN,
      }),
    ).toBe(false);
    expect(
      shouldSync({ ...base, mode: "active", lastActivityAt: null, lastCycleAt: now - 5 * MIN }),
    ).toBe(false);
  });

  it("active: a full idle day still gets one catch-up cycle", () => {
    expect(
      shouldSync({ ...base, mode: "active", lastActivityAt: null, lastCycleAt: now - 24 * HOUR }),
    ).toBe(true);
    expect(
      shouldSync({
        ...base,
        mode: "active",
        lastActivityAt: now - 2 * HOUR,
        lastCycleAt: now - 23 * HOUR,
      }),
    ).toBe(false); // recently synced + not in use -> stay asleep
  });

  it("active: fresh boot (no cycle yet) syncs once", () => {
    expect(
      shouldSync({ ...base, mode: "active", lastActivityAt: null, lastCycleAt: null }),
    ).toBe(true);
  });
});
