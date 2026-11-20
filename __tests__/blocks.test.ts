import { describe, expect, it } from "vitest";
import {
  computeFinalBlockIds,
  mergeAdjacentBlocks,
  rangeFitsInFreeBlocks,
  snapTo15,
  splitBlockAt,
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

describe("splitBlockAt", () => {
  const existing = { startMinutes: 540, endMinutes: 660 }; // 09:00-11:00

  it("splits into before/inserted/after when the drop lands in the middle", () => {
    const result = splitBlockAt(existing, 600, 30); // drop at 10:00, 30min task
    expect(result.before).toEqual({ startMinutes: 540, endMinutes: 600 });
    expect(result.inserted).toEqual({ startMinutes: 600, endMinutes: 630 });
    expect(result.after).toEqual({ startMinutes: 630, endMinutes: 660 });
  });

  it("caps the inserted duration to the room left in the block", () => {
    const result = splitBlockAt(existing, 630, 60); // only 30min left after 10:30
    expect(result.inserted).toEqual({ startMinutes: 630, endMinutes: 660 });
    expect(result.after).toBeNull();
  });

  it("has no 'before' when the drop lands exactly at the block's start", () => {
    const result = splitBlockAt(existing, 540, 15);
    expect(result.before).toBeNull();
    expect(result.inserted).toEqual({ startMinutes: 540, endMinutes: 555 });
    expect(result.after).toEqual({ startMinutes: 555, endMinutes: 660 });
  });

  it("snaps an off-grid drop point to the nearest quarter hour", () => {
    const result = splitBlockAt(existing, 598, 15); // 598 -> snaps to 600
    expect(result.inserted.startMinutes).toBe(600);
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
