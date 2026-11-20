import { describe, expect, it } from "vitest";
import { buildWeekPlan, partitionProtected, behindRemainderCandidates, type BuildCandidate, type ExistingRow, type ExistingRowWithHours } from "@/lib/plan-build";
import type { FreeBlock } from "@/lib/auto-placement";

function candidate(overrides: Partial<BuildCandidate> & { reference: string }): BuildCandidate {
  return {
    source: "asana",
    rootRef: overrides.reference,
    stageOrder: 0,
    must: false,
    hasHardDeadline: false,
    dueOn: null,
    priority: null,
    focusType: "shallow",
    estimateHours: 1,
    blockedByGids: [],
    isSuggested: false,
    ...overrides,
  };
}

const DAY_ORDER = ["2026-11-23", "2026-11-24"];
function freeBlocks(): Map<string, FreeBlock[]> {
  return new Map([
    ["2026-11-23", [{ startMinutes: 540, endMinutes: 1020 }]], // 8h
    ["2026-11-24", [{ startMinutes: 540, endMinutes: 1020 }]],
  ]);
}

describe("buildWeekPlan", () => {
  it("produces a correctly-ordered plan from a fixture mix with no manual step", () => {
    const candidates = [
      candidate({ reference: "low", priority: "Low", estimateHours: 2 }),
      candidate({ reference: "must", must: true, estimateHours: 1 }),
      candidate({ reference: "deadline", hasHardDeadline: true, estimateHours: 1 }),
      candidate({ reference: "high", priority: "High", estimateHours: 1 }),
      candidate({ reference: "noestimate", isSuggested: true, estimateHours: 1 }),
    ];
    const result = buildWeekPlan(candidates, freeBlocks(), DAY_ORDER, 100, new Map());

    const placedRefs = result.placements.map((p) => p.reference);
    expect(placedRefs).toContain("must");
    expect(placedRefs).toContain("deadline");
    expect(placedRefs).toContain("noestimate");
    expect(result.stillUnplaced).toEqual([]);
    expect(result.movedToNextWeek).toEqual([]);

    const suggested = result.placements.find((p) => p.reference === "noestimate");
    expect(suggested?.isSuggested).toBe(true);
    const confirmed = result.placements.find((p) => p.reference === "must");
    expect(confirmed?.isSuggested).toBe(false);
  });

  it("never places a task before an unfinished blocker", () => {
    const candidates = [candidate({ reference: "blocked", blockedByGids: ["blocker-1"] })];
    const completedByGid = new Map([["blocker-1", false]]);
    const result = buildWeekPlan(candidates, freeBlocks(), DAY_ORDER, 100, completedByGid);

    expect(result.placements).toEqual([]);
    expect(result.stillUnplaced).toEqual([{ source: "asana", reference: "blocked", reason: "Waiting on a blocker" }]);
  });

  it("places a task once its blocker is completed", () => {
    const candidates = [candidate({ reference: "unblocked", blockedByGids: ["blocker-1"] })];
    const completedByGid = new Map([["blocker-1", true]]);
    const result = buildWeekPlan(candidates, freeBlocks(), DAY_ORDER, 100, completedByGid);

    expect(result.placements.map((p) => p.reference)).toEqual(["unblocked"]);
  });

  it("defers the lowest-ranked, non-Must candidates to next week when over capacity", () => {
    const candidates = [
      candidate({ reference: "must", must: true, estimateHours: 6 }),
      candidate({ reference: "low", priority: "Low", estimateHours: 6 }),
    ];
    const result = buildWeekPlan(candidates, freeBlocks(), DAY_ORDER, 8, new Map());

    expect(result.movedToNextWeek).toEqual([{ source: "asana", reference: "low" }]);
    expect(result.placements.map((p) => p.reference)).toEqual(["must"]);
  });
});

describe("partitionProtected", () => {
  function row(overrides: Partial<ExistingRow> & { key: string }): ExistingRow {
    return { day: "2026-11-23", pinned: false, status: "planned", ...overrides };
  }

  it("protects a pinned row", () => {
    const result = partitionProtected([row({ key: "a", pinned: true })], "2026-11-20");
    expect(result.protectedKeys.has("a")).toBe(true);
  });

  it("protects a Done or Behind row even when not pinned", () => {
    const result = partitionProtected(
      [row({ key: "done", status: "done" }), row({ key: "behind", status: "behind" })],
      "2026-11-20"
    );
    expect(result.protectedKeys.has("done")).toBe(true);
    expect(result.protectedKeys.has("behind")).toBe(true);
  });

  it("protects a past-dated row", () => {
    const result = partitionProtected([row({ key: "past", day: "2026-11-18" })], "2026-11-20");
    expect(result.protectedKeys.has("past")).toBe(true);
  });

  it("leaves an ordinary, unpinned, future-dated row unprotected", () => {
    const result = partitionProtected([row({ key: "ordinary", day: "2026-11-25" })], "2026-11-20");
    expect(result.unprotectedKeys.has("ordinary")).toBe(true);
  });

  it("treats an unplaced row (day null) as unprotected unless pinned/done/behind", () => {
    const result = partitionProtected([row({ key: "unplaced", day: null })], "2026-11-20");
    expect(result.unprotectedKeys.has("unplaced")).toBe(true);
  });
});

describe("behindRemainderCandidates", () => {
  function existingRow(overrides: Partial<ExistingRowWithHours> & { key: string }): ExistingRowWithHours {
    return { day: "2026-11-18", pinned: false, status: "behind", hours: null, ...overrides };
  }

  it("produces a remainder candidate sized to the full remaining hours when nothing else is pinned", () => {
    const candidates = [candidate({ reference: "a", estimateHours: 14 })];
    const existing = [existingRow({ key: "asana:a", status: "behind" })];
    const result = behindRemainderCandidates(candidates, existing, new Map([["asana:a", 5]]));
    expect(result).toEqual([{ ...candidates[0], estimateHours: 5, isSuggested: false }]);
  });

  it("subtracts hours already pinned down later this week", () => {
    const candidates = [candidate({ reference: "a" })];
    const existing = [
      existingRow({ key: "asana:a", status: "behind" }),
      existingRow({ key: "asana:a", status: "planned", pinned: true, hours: 2 }),
    ];
    const result = behindRemainderCandidates(candidates, existing, new Map([["asana:a", 5]]));
    expect(result[0].estimateHours).toBe(3);
  });

  it("does not subtract an unpinned later block — it's about to be rebuilt by this same pass anyway", () => {
    const candidates = [candidate({ reference: "a" })];
    const existing = [
      existingRow({ key: "asana:a", status: "behind" }),
      existingRow({ key: "asana:a", status: "planned", pinned: false, hours: 2 }),
    ];
    const result = behindRemainderCandidates(candidates, existing, new Map([["asana:a", 5]]));
    expect(result[0].estimateHours).toBe(5);
  });

  it("produces nothing once the pinned remainder already covers the full hours left (self-stabilizing)", () => {
    const candidates = [candidate({ reference: "a" })];
    const existing = [
      existingRow({ key: "asana:a", status: "behind" }),
      existingRow({ key: "asana:a", status: "planned", pinned: true, hours: 5 }),
    ];
    const result = behindRemainderCandidates(candidates, existing, new Map([["asana:a", 5]]));
    expect(result).toEqual([]);
  });

  it("produces nothing when there's no Behind row this week for that task (stale or unrelated remaining_hours)", () => {
    const candidates = [candidate({ reference: "a" })];
    const existing = [existingRow({ key: "asana:a", status: "planned" })];
    const result = behindRemainderCandidates(candidates, existing, new Map([["asana:a", 5]]));
    expect(result).toEqual([]);
  });

  it("produces nothing when the task has no matching normal candidate (e.g. no longer eligible)", () => {
    const existing = [existingRow({ key: "asana:gone", status: "behind" })];
    const result = behindRemainderCandidates([], existing, new Map([["asana:gone", 5]]));
    expect(result).toEqual([]);
  });

  it("a Done later block counts as already committed too, even unpinned — Done always survives a rebuild", () => {
    const candidates = [candidate({ reference: "a" })];
    const existing = [
      existingRow({ key: "asana:a", status: "behind" }),
      existingRow({ key: "asana:a", status: "done", pinned: false, hours: 2 }),
    ];
    const result = behindRemainderCandidates(candidates, existing, new Map([["asana:a", 5]]));
    expect(result[0].estimateHours).toBe(3);
  });
});
