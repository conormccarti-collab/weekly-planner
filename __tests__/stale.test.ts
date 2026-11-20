import { describe, expect, it } from "vitest";
import { isStale, STALE_AFTER_DAYS } from "@/lib/stale";

describe("isStale", () => {
  const today = "2026-11-20";

  it("is never stale with no due date", () => {
    expect(isStale(null, today)).toBe(false);
  });

  it("is not stale exactly at the threshold", () => {
    expect(isStale("2026-11-06", today)).toBe(false); // 14 days overdue
  });

  it("is stale one day past the threshold", () => {
    expect(isStale("2026-11-05", today)).toBe(true); // 15 days overdue
  });

  it("is not stale for a future or current due date", () => {
    expect(isStale("2026-11-20", today)).toBe(false);
    expect(isStale("2026-12-01", today)).toBe(false);
  });

  it(`STALE_AFTER_DAYS is 14 per the brief`, () => {
    expect(STALE_AFTER_DAYS).toBe(14);
  });
});
