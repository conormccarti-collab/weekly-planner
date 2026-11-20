import { describe, expect, it } from "vitest";
import { computeDayTotals, computeStageBreakdown, computeWeekTotals, isDueThisWeekOrOverdue } from "@/lib/plan";

describe("isDueThisWeekOrOverdue", () => {
  const weekEndExclusive = "2026-11-23"; // week of Mon 2026-11-16

  it("is true for a task due earlier in the week", () => {
    expect(isDueThisWeekOrOverdue("2026-11-18", weekEndExclusive)).toBe(true);
  });

  it("is true for an overdue task (due before this week even started)", () => {
    expect(isDueThisWeekOrOverdue("2026-10-01", weekEndExclusive)).toBe(true);
  });

  it("is false for a task due next week or later", () => {
    expect(isDueThisWeekOrOverdue("2026-11-23", weekEndExclusive)).toBe(false);
    expect(isDueThisWeekOrOverdue("2026-12-01", weekEndExclusive)).toBe(false);
  });

  it("is false when there's no due date at all", () => {
    expect(isDueThisWeekOrOverdue(null, weekEndExclusive)).toBe(false);
  });
});

describe("computeDayTotals", () => {
  it("sums placed hours and flags over-capacity", () => {
    const result = computeDayTotals([3, 2], 7);
    expect(result).toEqual({ plannedHours: 5, capacityHours: 7, overCapacity: false });
  });

  it("is over capacity when planned hours exceed the day's capacity", () => {
    const result = computeDayTotals([5, 4], 7);
    expect(result.plannedHours).toBe(9);
    expect(result.overCapacity).toBe(true);
  });

  it("exactly at capacity is not over capacity", () => {
    const result = computeDayTotals([7], 7);
    expect(result.overCapacity).toBe(false);
  });

  it("handles an empty day", () => {
    expect(computeDayTotals([], 7)).toEqual({ plannedHours: 0, capacityHours: 7, overCapacity: false });
  });
});

describe("computeWeekTotals", () => {
  it("sums across days and flags over-capacity at the week level", () => {
    const days = [
      { plannedHours: 8, capacityHours: 7, overCapacity: true },
      { plannedHours: 5, capacityHours: 7, overCapacity: false },
    ];
    const result = computeWeekTotals(days);
    expect(result).toEqual({ plannedHours: 13, capacityHours: 14, overCapacity: false });
  });

  it("is over capacity when the week total exceeds week capacity even if no single day is", () => {
    const days = [
      { plannedHours: 7, capacityHours: 7, overCapacity: false },
      { plannedHours: 7.5, capacityHours: 7, overCapacity: true },
    ];
    const result = computeWeekTotals(days);
    expect(result.overCapacity).toBe(true);
  });
});

describe("computeStageBreakdown", () => {
  it("sums planned hours across tasks sharing a stage", () => {
    const result = computeStageBreakdown([
      { stage: "Edit", placements: [{ hours: 3, actualHours: null, status: "planned" }] },
      { stage: "Edit", placements: [{ hours: 2, actualHours: null, status: "planned" }] },
    ]);
    expect(result).toEqual([{ stage: "Edit", plannedHours: 5, actualHours: 0 }]);
  });

  it("only counts actual hours for placements marked done", () => {
    const result = computeStageBreakdown([
      {
        stage: "Edit",
        placements: [
          { hours: 3, actualHours: 4, status: "done" },
          { hours: 2, actualHours: 5, status: "planned" }, // not done — ignored for actual
        ],
      },
    ]);
    expect(result).toEqual([{ stage: "Edit", plannedHours: 5, actualHours: 4 }]);
  });

  it("groups a null stage under 'Other'", () => {
    const result = computeStageBreakdown([
      { stage: null, placements: [{ hours: 1, actualHours: null, status: "planned" }] },
    ]);
    expect(result).toEqual([{ stage: "Other", plannedHours: 1, actualHours: 0 }]);
  });

  it("omits a stage with no planned or actual hours", () => {
    const result = computeStageBreakdown([{ stage: "Shoot", placements: [] }]);
    expect(result).toEqual([]);
  });

  it("sorts by planned hours, highest first", () => {
    const result = computeStageBreakdown([
      { stage: "Shorts", placements: [{ hours: 1, actualHours: null, status: "planned" }] },
      { stage: "Edit", placements: [{ hours: 5, actualHours: null, status: "planned" }] },
    ]);
    expect(result.map((r) => r.stage)).toEqual(["Edit", "Shorts"]);
  });
});
