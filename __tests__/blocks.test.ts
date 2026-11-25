import { describe, expect, it } from "vitest";
import {
  complementRanges,
  computeFinalBlockIds,
  diagnoseDrop,
  findNearestFreeSlot,
  mergeAdjacentBlocks,
  rangeFitsInFreeBlocks,
  labelPartsByTask,
  snapTo15,
  subtractOccupied,
  type BlockRef,
} from "@/lib/blocks";

describe("snapTo15", () => {
  it("rounds to the nearest quarter hour", () => {
    expect(snapTo15(547)).toBe(540);
    expect(snapTo15(553)).toBe(555);
    expect(snapTo15(540)).toBe(540);
  });
});

describe("rangeFitsInFreeBlocks", () => {
  const free = [{ startMinutes: 540, endMinutes: 600 }, { startMinutes: 630, endMinutes: 720 }];

  it("fits entirely inside one free block", () => {
    expect(rangeFitsInFreeBlocks({ startMinutes: 550, endMinutes: 590 }, free)).toBe(true);
  });

  it("rejects a range that spans a gap between free blocks", () => {
    expect(rangeFitsInFreeBlocks({ startMinutes: 590, endMinutes: 640 }, free)).toBe(false);
  });

  it("rejects a zero or negative-length range", () => {
    expect(rangeFitsInFreeBlocks({ startMinutes: 550, endMinutes: 550 }, free)).toBe(false);
  });

  it("rejects a range outside every free block", () => {
    expect(rangeFitsInFreeBlocks({ startMinutes: 0, endMinutes: 30 }, free)).toBe(false);
  });
});

describe("subtractOccupied", () => {
  it("carves an occupied range out of the middle of a free block", () => {
    const result = subtractOccupied(
      [{ startMinutes: 540, endMinutes: 660 }],
      [{ startMinutes: 570, endMinutes: 600 }]
    );
    expect(result).toEqual([
      { startMinutes: 540, endMinutes: 570 },
      { startMinutes: 600, endMinutes: 660 },
    ]);
  });

  it("returns the free block unchanged when nothing occupies it", () => {
    const result = subtractOccupied([{ startMinutes: 540, endMinutes: 660 }], []);
    expect(result).toEqual([{ startMinutes: 540, endMinutes: 660 }]);
  });

  it("removes a free block entirely when fully occupied", () => {
    const result = subtractOccupied(
      [{ startMinutes: 540, endMinutes: 600 }],
      [{ startMinutes: 540, endMinutes: 600 }]
    );
    expect(result).toEqual([]);
  });
});

describe("mergeAdjacentBlocks", () => {
  function block(id: string, startMinutes: number, endMinutes: number, overrides: Partial<BlockRef> = {}): BlockRef {
    return { id, source: "asana", reference: "task-a", day: "2026-11-18", startMinutes, endMinutes, ...overrides };
  }

  it("merges two touching blocks of the same task into one", () => {
    const result = mergeAdjacentBlocks([block("1", 540, 600), block("2", 600, 660)]);
    expect(result).toEqual([
      { keep: block("1", 540, 660), absorbed: [block("2", 600, 660)] },
    ]);
  });

  it("does not merge blocks with a gap between them", () => {
    const result = mergeAdjacentBlocks([block("1", 540, 600), block("2", 615, 660)]);
    expect(result).toEqual([]);
  });

  it("does not merge blocks belonging to different tasks", () => {
    const result = mergeAdjacentBlocks([block("1", 540, 600), block("2", 600, 660, { reference: "task-b" })]);
    expect(result).toEqual([]);
  });

  it("does not merge blocks on different days", () => {
    const result = mergeAdjacentBlocks([block("1", 540, 600), block("2", 600, 660, { day: "2026-11-19" })]);
    expect(result).toEqual([]);
  });

  it("chains three adjacent blocks into one merge group", () => {
    const result = mergeAdjacentBlocks([block("1", 540, 570), block("2", 570, 600), block("3", 600, 630)]);
    expect(result).toHaveLength(1);
    expect(result[0].keep).toEqual(block("1", 540, 630));
    expect(result[0].absorbed.map((b) => b.id)).toEqual(["2", "3"]);
  });
});

describe("computeFinalBlockIds", () => {
  function block(id: string, day: string, startMinutes: number, endMinutes: number, reference = "task-a"): BlockRef {
    return { id, source: "asana", reference, day, startMinutes, endMinutes };
  }

  it("picks the chronologically last block per task across days", () => {
    const ids = computeFinalBlockIds([
      block("1", "2026-11-18", 540, 600),
      block("2", "2026-11-20", 540, 600),
      block("3", "2026-11-19", 540, 600),
    ]);
    expect(ids).toEqual(new Set(["2"]));
  });

  it("breaks ties on the same day by end time", () => {
    const ids = computeFinalBlockIds([
      block("1", "2026-11-18", 540, 600),
      block("2", "2026-11-18", 630, 660),
    ]);
    expect(ids).toEqual(new Set(["2"]));
  });

  it("tracks each task independently", () => {
    const ids = computeFinalBlockIds([
      block("1", "2026-11-18", 540, 600, "task-a"),
      block("2", "2026-11-19", 540, 600, "task-b"),
    ]);
    expect(ids).toEqual(new Set(["1", "2"]));
  });
});

describe("labelPartsByTask", () => {
  it("labels nothing when a task has only one block", () => {
    const labels = labelPartsByTask([{ id: "1", day: "2026-11-18", startMinutes: 540 }]);
    expect(labels.size).toBe(0);
  });

  it("labels multiple blocks in chronological order, day then start time", () => {
    const labels = labelPartsByTask([
      { id: "b", day: "2026-11-19", startMinutes: 540 },
      { id: "a", day: "2026-11-18", startMinutes: 600 },
      { id: "c", day: "2026-11-19", startMinutes: 480 },
    ]);
    expect(labels.get("a")).toEqual({ partIndex: 1, partCount: 3 });
    expect(labels.get("c")).toEqual({ partIndex: 2, partCount: 3 });
    expect(labels.get("b")).toEqual({ partIndex: 3, partCount: 3 });
  });
});

describe("complementRanges", () => {
  it("returns the gap before, between and after free blocks", () => {
    const bands = complementRanges(540, 900, [
      { startMinutes: 600, endMinutes: 660 },
      { startMinutes: 780, endMinutes: 840 },
    ]);
    expect(bands).toEqual([
      { startMinutes: 540, endMinutes: 600 },
      { startMinutes: 660, endMinutes: 780 },
      { startMinutes: 840, endMinutes: 900 },
    ]);
  });

  it("is empty when the whole window is free", () => {
    expect(complementRanges(540, 900, [{ startMinutes: 540, endMinutes: 900 }])).toEqual([]);
  });

  it("is the whole window when nothing is free", () => {
    expect(complementRanges(540, 900, [])).toEqual([{ startMinutes: 540, endMinutes: 900 }]);
  });
});

describe("findNearestFreeSlot", () => {
  it("snaps to 15 minutes within a free block that already fits", () => {
    expect(findNearestFreeSlot(548, 60, [{ startMinutes: 540, endMinutes: 720 }])).toBe(555);
  });

  it("clamps to the start of the nearest free block when the raw position is too early", () => {
    expect(findNearestFreeSlot(500, 60, [{ startMinutes: 540, endMinutes: 720 }])).toBe(540);
  });

  it("clamps so the full duration still fits when the raw position is too late in the block", () => {
    expect(findNearestFreeSlot(700, 60, [{ startMinutes: 540, endMinutes: 720 }])).toBe(660);
  });

  it("picks whichever of several free blocks is actually closest", () => {
    const freeBlocks = [
      { startMinutes: 540, endMinutes: 600 }, // 9:00-10:00, too short for 90min
      { startMinutes: 660, endMinutes: 840 }, // 11:00-14:00
    ];
    expect(findNearestFreeSlot(620, 90, freeBlocks)).toBe(660);
  });

  it("returns null when nothing can fit the duration", () => {
    expect(findNearestFreeSlot(600, 120, [{ startMinutes: 540, endMinutes: 600 }])).toBeNull();
  });
});

describe("diagnoseDrop", () => {
  const window = { startMinutes: 540, endMinutes: 1020 }; // 09:00-17:00
  const oneFreeBlock = [{ startMinutes: 540, endMinutes: 1020 }];

  it("is ok when the range fits cleanly and nothing else is there", () => {
    expect(diagnoseDrop({ startMinutes: 600, endMinutes: 660 }, window, oneFreeBlock, [])).toEqual({ ok: true });
  });

  it("names the day having no capacity at all", () => {
    const result = diagnoseDrop({ startMinutes: 600, endMinutes: 660 }, window, [], []);
    expect(result).toEqual({ ok: false, reason: "no-capacity", message: "That day has no capacity" });
  });

  it("names a meeting the range overlaps, with its time", () => {
    const freeBlocks = [
      { startMinutes: 540, endMinutes: 660 }, // free until 11:00
      { startMinutes: 720, endMinutes: 1020 }, // free again from 12:00 (11:00-12:00 is a meeting)
    ];
    const result = diagnoseDrop({ startMinutes: 630, endMinutes: 690 }, window, freeBlocks, []);
    expect(result).toEqual({ ok: false, reason: "meeting", message: "Overlaps a meeting at 11:00–12:00" });
  });

  it("names a conflicting task block, not a meeting, when the overlap is with another placement", () => {
    const otherBlocks = [{ id: "other-1", name: "Edit the Arran video", startMinutes: 600, endMinutes: 660 }];
    const result = diagnoseDrop({ startMinutes: 630, endMinutes: 690 }, window, oneFreeBlock, otherBlocks);
    expect(result).toEqual({
      ok: false,
      reason: "block",
      message: "Overlaps Edit the Arran video at 10:00–11:00",
      conflictingBlockId: "other-1",
      conflictingName: "Edit the Arran video",
    });
  });

  it("checks for a conflicting block before checking free blocks at all", () => {
    // Free calendar-wise, but another task is already sitting there.
    const otherBlocks = [{ id: "other-1", name: "Review cut", startMinutes: 600, endMinutes: 660 }];
    const result = diagnoseDrop({ startMinutes: 600, endMinutes: 660 }, window, oneFreeBlock, otherBlocks);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("block");
  });
});
