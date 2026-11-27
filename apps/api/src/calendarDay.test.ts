import { describe, expect, it } from "vitest";
import { snippetFor } from "./calendarDay";

describe("snippetFor", () => {
  it("matches case-insensitively and preserves the log's casing in `match`", () => {
    const hit = snippetFor("Went Climbing with friends", "climbing");
    expect(hit).toEqual({ before: "Went ", match: "Climbing", after: " with friends", matches: 1 });
  });

  it("returns null when the query is absent or blank", () => {
    expect(snippetFor("nothing here", "gym")).toBeNull();
    expect(snippetFor("nothing here", "   ")).toBeNull();
  });

  it("collapses whitespace and counts every occurrence", () => {
    const hit = snippetFor("gym\n\nthen  gym again\tgym", "gym");
    expect(hit?.before).toBe("");
    expect(hit?.after).toBe(" then gym again gym");
    expect(hit?.matches).toBe(3);
  });

  it("clips long context on both sides with ellipses", () => {
    const pad = "x".repeat(200);
    const hit = snippetFor(`${pad} yoga ${pad}`, "yoga");
    expect(hit?.before.startsWith("...")).toBe(true);
    expect(hit?.before.length).toBeLessThanOrEqual(3 + 40);
    expect(hit?.after.endsWith("...")).toBe(true);
    expect(hit?.after.length).toBeLessThanOrEqual(80 + 3);
    expect(hit?.match).toBe("yoga");
  });

  it("keeps a match that spans a collapsed line break", () => {
    const hit = snippetFor("morning\nrun", "morning run");
    expect(hit?.match).toBe("morning run");
  });
});
