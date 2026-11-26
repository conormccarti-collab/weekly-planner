import { describe, expect, it } from "vitest";
import { resolveNewDurationMinutes, resolveEvenSplit } from "@/lib/chat/duration-change";

describe("resolveNewDurationMinutes", () => {
  it("keeps the old duration when neither an absolute nor a relative change is given", () => {
    expect(resolveNewDurationMinutes(60, null, null)).toBe(60);
  });

  it("uses the absolute total when one is given", () => {
    expect(resolveNewDurationMinutes(60, 3, null)).toBe(180);
  });

  it("adds a positive delta to the real current duration — 'give it another hour'", () => {
    expect(resolveNewDurationMinutes(60, null, 1)).toBe(120);
  });

  it("subtracts a negative delta — 'half an hour less'", () => {
    expect(resolveNewDurationMinutes(120, null, -0.5)).toBe(90);
  });

  it("prefers the absolute figure over a delta if the model somehow sends both", () => {
    expect(resolveNewDurationMinutes(60, 4, 1)).toBe(240);
  });
});

describe("resolveEvenSplit", () => {
  it("splits the real total evenly across every null entry — 'only Scott Dunn images this weekend', 14h over 2 days", () => {
    const result = resolveEvenSplit(14, [
      { day: "2026-11-28", hours: null },
      { day: "2026-11-29", hours: null },
    ]);
    expect(result).toEqual([
      { day: "2026-11-28", hours: 7 },
      { day: "2026-11-29", hours: 7 },
    ]);
  });

  it("leaves explicit entries untouched and only resolves the null ones", () => {
    const result = resolveEvenSplit(14, [
      { day: "2026-11-27", hours: 4 },
      { day: "2026-11-28", hours: null },
      { day: "2026-11-29", hours: null },
    ]);
    expect(result).toEqual([
      { day: "2026-11-27", hours: 4 },
      { day: "2026-11-28", hours: 5 },
      { day: "2026-11-29", hours: 5 },
    ]);
  });

  it("returns the explicit hours unchanged when nothing is null", () => {
    const result = resolveEvenSplit(99, [
      { day: "2026-11-28", hours: 6 },
      { day: "2026-11-29", hours: 8 },
    ]);
    expect(result).toEqual([
      { day: "2026-11-28", hours: 6 },
      { day: "2026-11-29", hours: 8 },
    ]);
  });

  it("rounds to the nearest quarter-hour and absorbs the remainder on the last null entry so the total is exact", () => {
    const result = resolveEvenSplit(10, [
      { day: "2026-11-28", hours: null },
      { day: "2026-11-29", hours: null },
      { day: "2026-11-30", hours: null },
    ]);
    const total = result.reduce((sum, r) => sum + r.hours, 0);
    expect(total).toBe(10);
    expect(result[0].hours).toBe(3.25);
    expect(result[1].hours).toBe(3.25);
  });
});
