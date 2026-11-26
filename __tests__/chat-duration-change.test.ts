import { describe, expect, it } from "vitest";
import { resolveNewDurationMinutes, resolveEvenSplit, capDistributionToCapacity, mergeDuplicateDayEntries } from "@/lib/chat/duration-change";

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

describe("capDistributionToCapacity", () => {
  it("places the full amount when every day has room", () => {
    const result = capDistributionToCapacity(
      [
        { day: "2026-11-28", hours: 7 },
        { day: "2026-11-29", hours: 7 },
      ],
      new Map([
        ["2026-11-28", 7],
        ["2026-11-29", 7],
      ])
    );
    expect(result).toEqual({
      placements: [
        { day: "2026-11-28", hours: 7 },
        { day: "2026-11-29", hours: 7 },
      ],
      leftoverHours: 0,
    });
  });

  it("carries a day's shortfall onto the next named day, but never past that day's own real capacity", () => {
    // Saturday 7h desired, only 5.95h free (buffer-reduced): 1.05h carries to
    // Sunday. Sunday's own 7h free can take its own 7h desired OR the carry,
    // not both uncapped — it's still capped at 7h, and the remaining 1.05h
    // is honest leftover rather than silently exceeding Sunday's real room.
    const result = capDistributionToCapacity(
      [
        { day: "2026-11-28", hours: 7 },
        { day: "2026-11-29", hours: 7 },
      ],
      new Map([
        ["2026-11-28", 5.95],
        ["2026-11-29", 7],
      ])
    );
    expect(result.placements).toEqual([
      { day: "2026-11-28", hours: 5.95 },
      { day: "2026-11-29", hours: 7 },
    ]);
    expect(result.leftoverHours).toBeCloseTo(1.05, 10);
  });

  it("returns leftoverHours when even the last day can't absorb the carry", () => {
    const result = capDistributionToCapacity(
      [
        { day: "2026-11-28", hours: 7 },
        { day: "2026-11-29", hours: 7 },
      ],
      new Map([
        ["2026-11-28", 5.95],
        ["2026-11-29", 5.95],
      ])
    );
    expect(result.placements).toEqual([
      { day: "2026-11-28", hours: 5.95 },
      { day: "2026-11-29", hours: 5.95 },
    ]);
    expect(result.leftoverHours).toBeCloseTo(2.1, 10);
  });

  it("skips a day entirely (no placement) when it has zero free capacity", () => {
    const result = capDistributionToCapacity(
      [
        { day: "2026-11-28", hours: 7 },
        { day: "2026-11-29", hours: 7 },
      ],
      new Map([
        ["2026-11-28", 0],
        ["2026-11-29", 14],
      ])
    );
    expect(result).toEqual({
      placements: [{ day: "2026-11-29", hours: 14 }],
      leftoverHours: 0,
    });
  });

  it("treats a day missing from the capacity map as having no room", () => {
    const result = capDistributionToCapacity([{ day: "2026-11-28", hours: 5 }], new Map());
    expect(result).toEqual({ placements: [], leftoverHours: 5 });
  });
});

describe("mergeDuplicateDayEntries", () => {
  it("sums hours for a day named more than once — 'the real underlying bug: 3h today and 2h today'", () => {
    const result = mergeDuplicateDayEntries([
      { day: "2026-11-26", hours: 3 },
      { day: "2026-11-26", hours: 2 },
    ]);
    expect(result).toEqual([{ day: "2026-11-26", hours: 5 }]);
  });

  it("leaves distinct days untouched, in first-seen order", () => {
    const result = mergeDuplicateDayEntries([
      { day: "2026-11-28", hours: 7 },
      { day: "2026-11-29", hours: 7 },
    ]);
    expect(result).toEqual([
      { day: "2026-11-28", hours: 7 },
      { day: "2026-11-29", hours: 7 },
    ]);
  });

  it("merges a repeat wherever it appears, keeping the day's first position", () => {
    const result = mergeDuplicateDayEntries([
      { day: "2026-11-28", hours: 2 },
      { day: "2026-11-29", hours: 4 },
      { day: "2026-11-28", hours: 3 },
    ]);
    expect(result).toEqual([
      { day: "2026-11-28", hours: 5 },
      { day: "2026-11-29", hours: 4 },
    ]);
  });
});
