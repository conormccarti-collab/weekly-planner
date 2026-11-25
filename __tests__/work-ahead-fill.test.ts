import { describe, expect, it } from "vitest";
import { computeSlackFill, freeBlocksFromCurrentPlacements } from "@/lib/work-ahead-fill";
import type { DayShape, ExistingBlock } from "@/lib/resolve-drop";
import type { AutoPlaceCandidate } from "@/lib/auto-placement";

const WINDOW = { windowStartMinutes: 540, windowEndMinutes: 1020 }; // 09:00–17:00

function day(dateStr: string, overrides: Partial<DayShape> = {}): DayShape {
  return {
    day: dateStr,
    windowStartMinutes: WINDOW.windowStartMinutes,
    windowEndMinutes: WINDOW.windowEndMinutes,
    calendarFreeBlocks: [{ startMinutes: WINDOW.windowStartMinutes, endMinutes: WINDOW.windowEndMinutes }],
    isWorkingDay: true,
    ...overrides,
  };
}

function block(overrides: Partial<ExistingBlock> & Pick<ExistingBlock, "id" | "day" | "startMinutes" | "endMinutes">): ExistingBlock {
  return {
    source: "personal",
    reference: overrides.id,
    name: overrides.id,
    pinned: false,
    done: false,
    ...overrides,
  };
}

function candidate(overrides: Partial<AutoPlaceCandidate> & { reference: string }): AutoPlaceCandidate {
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
    ...overrides,
  };
}

describe("freeBlocksFromCurrentPlacements", () => {
  it("treats every existing block as an obstacle, pinned or not", () => {
    const days = [day("2026-11-23")];
    const blocks = [block({ id: "a", day: "2026-11-23", startMinutes: 540, endMinutes: 600, pinned: false })];
    const { freeBlocksByDay } = freeBlocksFromCurrentPlacements(days, blocks);
    expect(freeBlocksByDay.get("2026-11-23")).toEqual([{ startMinutes: 600, endMinutes: 1020 }]);
  });

  it("excludes a non-working day from dayOrder entirely", () => {
    const days = [day("2026-11-23"), day("2026-11-28", { isWorkingDay: false })];
    const { dayOrder } = freeBlocksFromCurrentPlacements(days, []);
    expect(dayOrder).toEqual(["2026-11-23"]);
  });

  it("gives a day with nothing placed its full window as one free block", () => {
    const days = [day("2026-11-23")];
    const { freeBlocksByDay } = freeBlocksFromCurrentPlacements(days, []);
    expect(freeBlocksByDay.get("2026-11-23")).toEqual([{ startMinutes: 540, endMinutes: 1020 }]);
  });
});

describe("computeSlackFill", () => {
  it("places extra candidates into free slack, ranked the same way the weekly build ranks them", () => {
    const freeBlocksByDay = new Map([["2026-11-23", [{ startMinutes: 540, endMinutes: 660 }]]]); // 2h
    const result = computeSlackFill(
      [candidate({ reference: "low", estimateHours: 1, priority: "Low" }), candidate({ reference: "high", estimateHours: 1, priority: "High" })],
      freeBlocksByDay,
      ["2026-11-23"]
    );
    expect(result.placements.map((p) => p.reference)).toEqual(["high", "low"]);
    expect(result.filledHours).toBe(2);
  });

  it("leaves whatever doesn't fit unplaced rather than overflowing", () => {
    const freeBlocksByDay = new Map([["2026-11-23", [{ startMinutes: 540, endMinutes: 600 }]]]); // 1h
    const result = computeSlackFill([candidate({ reference: "a", estimateHours: 3 })], freeBlocksByDay, ["2026-11-23"]);
    expect(result.placements).toEqual([]);
    expect(result.filledHours).toBe(0);
  });

  it("reports zero filled hours when there's nothing to place", () => {
    const result = computeSlackFill([], new Map(), []);
    expect(result).toEqual({ placements: [], filledHours: 0 });
  });
});
