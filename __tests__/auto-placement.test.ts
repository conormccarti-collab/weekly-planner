import { describe, expect, it } from "vitest";
import { orderCandidatesForPlacement, proposeAutoPlacement, type AutoPlaceCandidate, type FreeBlock } from "@/lib/auto-placement";

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

describe("orderCandidatesForPlacement", () => {
  it("puts Must tasks first", () => {
    const result = orderCandidatesForPlacement([
      candidate({ reference: "a" }),
      candidate({ reference: "b", must: true }),
    ]);
    expect(result.map((c) => c.reference)).toEqual(["b", "a"]);
  });

  it("puts a hard-deadline task ahead of one with none, before priority", () => {
    const result = orderCandidatesForPlacement([
      candidate({ reference: "a", priority: "High" }),
      candidate({ reference: "b", hasHardDeadline: true }),
    ]);
    expect(result.map((c) => c.reference)).toEqual(["b", "a"]);
  });

  it("a task's own due date alone doesn't count as a hard deadline", () => {
    const result = orderCandidatesForPlacement([
      candidate({ reference: "a", priority: "High" }),
      candidate({ reference: "b", dueOn: "2026-12-01" }),
    ]);
    expect(result.map((c) => c.reference)).toEqual(["a", "b"]);
  });

  it("breaks ties by priority, High before Medium before Low before none", () => {
    const result = orderCandidatesForPlacement([
      candidate({ reference: "low", priority: "Low" }),
      candidate({ reference: "none" }),
      candidate({ reference: "high", priority: "High" }),
      candidate({ reference: "medium", priority: "Medium" }),
    ]);
    expect(result.map((c) => c.reference)).toEqual(["high", "medium", "low", "none"]);
  });

  it("breaks remaining ties by due date, earliest first", () => {
    const result = orderCandidatesForPlacement([
      candidate({ reference: "later", dueOn: "2026-12-05" }),
      candidate({ reference: "earlier", dueOn: "2026-12-01" }),
    ]);
    expect(result.map((c) => c.reference)).toEqual(["earlier", "later"]);
  });

  it("keeps a deliverable's stages in their own order regardless of individual priority", () => {
    const result = orderCandidatesForPlacement([
      candidate({ reference: "review", rootRef: "deliverable", stageOrder: 2, priority: "Low" }),
      candidate({ reference: "edit", rootRef: "deliverable", stageOrder: 1, priority: "Low" }),
      candidate({ reference: "brief", rootRef: "deliverable", stageOrder: 0, priority: "High" }),
      candidate({ reference: "unrelated", priority: "High" }),
    ]);
    // "brief" is High priority, same as "unrelated", and appears earlier in
    // the input, so its group ("deliverable") wins that tie and goes first
    // — but within the group, stage order (not priority) decides the rest.
    expect(result.map((c) => c.reference)).toEqual(["brief", "edit", "review", "unrelated"]);
  });

  it("a later-input High-priority task still sorts before an earlier-input deliverable of only Low priority", () => {
    const result = orderCandidatesForPlacement([
      candidate({ reference: "edit", rootRef: "deliverable", stageOrder: 1, priority: "Low" }),
      candidate({ reference: "brief", rootRef: "deliverable", stageOrder: 0, priority: "Low" }),
      candidate({ reference: "unrelated", priority: "High" }),
    ]);
    expect(result.map((c) => c.reference)).toEqual(["unrelated", "brief", "edit"]);
  });
});

describe("proposeAutoPlacement", () => {
  const dayOrder = ["2026-11-16", "2026-11-17"];

  function freeBlocks(map: Record<string, FreeBlock[]>): Map<string, FreeBlock[]> {
    return new Map(Object.entries(map));
  }

  it("places a shallow task into a free block", () => {
    const result = proposeAutoPlacement(
      [candidate({ reference: "a", estimateHours: 1 })],
      freeBlocks({ "2026-11-16": [{ startMinutes: 540, endMinutes: 600 }] }),
      dayOrder
    );
    expect(result.placements).toEqual([
      { source: "asana", reference: "a", day: "2026-11-16", startMinutes: 540, endMinutes: 600 },
    ]);
    expect(result.unplaced).toEqual([]);
  });

  it("gives deep work the longest fitting block, not the first one", () => {
    const result = proposeAutoPlacement(
      [candidate({ reference: "deep", focusType: "deep", estimateHours: 2 })],
      freeBlocks({
        "2026-11-16": [{ startMinutes: 540, endMinutes: 660 }], // 2h
        "2026-11-17": [{ startMinutes: 540, endMinutes: 780 }], // 4h, longer
      }),
      dayOrder
    );
    expect(result.placements[0].day).toBe("2026-11-17");
  });

  it("shrinks the chosen block, leaving the remainder free for the next task", () => {
    const result = proposeAutoPlacement(
      [candidate({ reference: "a", estimateHours: 1 }), candidate({ reference: "b", estimateHours: 1 })],
      freeBlocks({ "2026-11-16": [{ startMinutes: 540, endMinutes: 660 }] }), // 2h block
      dayOrder
    );
    expect(result.placements).toEqual([
      { source: "asana", reference: "a", day: "2026-11-16", startMinutes: 540, endMinutes: 600 },
      { source: "asana", reference: "b", day: "2026-11-16", startMinutes: 600, endMinutes: 660 },
    ]);
  });

  it("never gives deep work a gap under 60 minutes", () => {
    const result = proposeAutoPlacement(
      [candidate({ reference: "deep", focusType: "deep", estimateHours: 0.5 })],
      freeBlocks({ "2026-11-16": [{ startMinutes: 540, endMinutes: 570 }] }), // 30min
      dayOrder
    );
    expect(result.placements).toEqual([]);
    expect(result.unplaced).toEqual([{ source: "asana", reference: "deep", reason: "No suitable free block this week" }]);
  });

  it("reserves a 60-74 minute gap for shallow work while shallow tasks remain", () => {
    const result = proposeAutoPlacement(
      [
        candidate({ reference: "deep", focusType: "deep", estimateHours: 1 }),
        candidate({ reference: "shallow", focusType: "shallow", estimateHours: 1 }),
      ],
      freeBlocks({ "2026-11-16": [{ startMinutes: 540, endMinutes: 600 }] }), // exactly 60min
      dayOrder
    );
    expect(result.placements.find((p) => p.reference === "deep")).toBeUndefined();
    expect(result.placements.find((p) => p.reference === "shallow")).toBeDefined();
  });

  it("lets deep work take a 60-74 minute gap once no shallow task is left", () => {
    const result = proposeAutoPlacement(
      [candidate({ reference: "deep", focusType: "deep", estimateHours: 1 })],
      freeBlocks({ "2026-11-16": [{ startMinutes: 540, endMinutes: 600 }] }), // exactly 60min
      dayOrder
    );
    expect(result.placements).toEqual([
      { source: "asana", reference: "deep", day: "2026-11-16", startMinutes: 540, endMinutes: 600 },
    ]);
  });

  it("skips away/waiting tasks entirely — nothing to place for a fixed-zero-hour task", () => {
    const result = proposeAutoPlacement(
      [candidate({ reference: "wait", focusType: "waiting", estimateHours: 0 })],
      freeBlocks({ "2026-11-16": [{ startMinutes: 540, endMinutes: 600 }] }),
      dayOrder
    );
    expect(result.placements).toEqual([]);
    expect(result.unplaced).toEqual([]);
  });

  it("leaves a task unplaced when nothing fits anywhere", () => {
    const result = proposeAutoPlacement(
      [candidate({ reference: "big", estimateHours: 5 })],
      freeBlocks({ "2026-11-16": [{ startMinutes: 540, endMinutes: 600 }] }),
      dayOrder
    );
    expect(result.placements).toEqual([]);
    expect(result.unplaced).toEqual([{ source: "asana", reference: "big", reason: "No suitable free block this week" }]);
  });
});
