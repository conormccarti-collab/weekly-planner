import { describe, expect, it } from "vitest";
import { closeGapsFrom } from "@/lib/reprioritise";
import type { DayShape, ExistingBlock } from "@/lib/resolve-drop";

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

const FIVE_DAYS = ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27"].map((d) => day(d));

describe("closeGapsFrom", () => {
  it("pulls a later block forward to close a gap left by finishing early", () => {
    // Finished a 09:00-09:30 task early — the gap left behind is 09:30-10:00.
    const later = block({ id: "later", day: "2026-11-23", startMinutes: 600, endMinutes: 660 }); // 10:00-11:00
    const result = closeGapsFrom({ anchor: { day: "2026-11-23", startMinutes: 570 }, days: FIVE_DAYS, blocks: [later] });
    expect(result.changes).toEqual([
      expect.objectContaining({ kind: "placed", day: "2026-11-23", startMinutes: 570, endMinutes: 630, reference: "later" }),
    ]);
  });

  it("leaves a block alone if there's no gap before it", () => {
    const touching = block({ id: "touching", day: "2026-11-23", startMinutes: 570, endMinutes: 630 });
    const result = closeGapsFrom({ anchor: { day: "2026-11-23", startMinutes: 570 }, days: FIVE_DAYS, blocks: [touching] });
    expect(result.changes).toEqual([]);
  });

  it("cascades through a chain of back-to-back blocks, closing the whole gap at once", () => {
    const first = block({ id: "first", day: "2026-11-23", startMinutes: 660, endMinutes: 720 }); // 11:00-12:00
    const second = block({ id: "second", day: "2026-11-23", startMinutes: 720, endMinutes: 780 }); // 12:00-13:00
    const result = closeGapsFrom({ anchor: { day: "2026-11-23", startMinutes: 570 }, days: FIVE_DAYS, blocks: [first, second] });
    expect(result.changes).toEqual([
      expect.objectContaining({ day: "2026-11-23", startMinutes: 570, endMinutes: 630, reference: "first" }),
      expect.objectContaining({ day: "2026-11-23", startMinutes: 630, endMinutes: 690, reference: "second" }),
    ]);
  });

  it("never moves a Done block or jumps it over — it stays a fixed obstacle", () => {
    // Only 30 minutes of real gap between the anchor and the Done block
    // (09:30-10:00) — too little for the 90-minute "after" block, so it must
    // jump over the Done block (10:00-11:30) rather than overlap it.
    const done = block({ id: "done", day: "2026-11-23", startMinutes: 600, endMinutes: 690, done: true });
    const after = block({ id: "after", day: "2026-11-23", startMinutes: 720, endMinutes: 810 }); // 90 minutes
    const result = closeGapsFrom({ anchor: { day: "2026-11-23", startMinutes: 570 }, days: FIVE_DAYS, blocks: [done, after] });
    expect(result.changes.some((c) => c.kind === "placed" && c.reference === "done")).toBe(false);
    expect(result.changes).toEqual([expect.objectContaining({ day: "2026-11-23", startMinutes: 690, endMinutes: 780, reference: "after" })]);
  });

  it("moves a pinned (manually placed) block too — confirmed: everything can move once drag no longer exists", () => {
    const pinned = block({ id: "pinned", day: "2026-11-23", startMinutes: 660, endMinutes: 720, pinned: true });
    const result = closeGapsFrom({ anchor: { day: "2026-11-23", startMinutes: 570 }, days: FIVE_DAYS, blocks: [pinned] });
    expect(result.changes).toEqual([expect.objectContaining({ day: "2026-11-23", startMinutes: 570, endMinutes: 630, reference: "pinned", pinned: true })]);
  });

  it("pulls a block forward from a later day when the whole rest of the anchor day is empty", () => {
    const tomorrow = block({ id: "tomorrow", day: "2026-11-24", startMinutes: 540, endMinutes: 600 });
    const result = closeGapsFrom({ anchor: { day: "2026-11-23", startMinutes: 570 }, days: FIVE_DAYS, blocks: [tomorrow] });
    expect(result.changes).toEqual([expect.objectContaining({ day: "2026-11-23", startMinutes: 570, endMinutes: 630, reference: "tomorrow" })]);
  });

  it("conserves total hours when a pulled-forward block has to split around an obstacle", () => {
    const meetingDay = day("2026-11-23", { calendarFreeBlocks: [{ startMinutes: 540, endMinutes: 600 }, { startMinutes: 630, endMinutes: 1020 }] }); // meeting 10:00-10:30
    const big = block({ id: "big", day: "2026-11-24", startMinutes: 540, endMinutes: 600 }); // 1h, originally tomorrow
    const result = closeGapsFrom({
      anchor: { day: "2026-11-23", startMinutes: 540 },
      days: [meetingDay, day("2026-11-24"), day("2026-11-25")],
      blocks: [big],
      minPartMinutes: 15,
    });
    const placedMinutes = result.changes
      .filter((c) => c.kind === "placed" && c.reference === "big")
      .reduce((sum, c) => sum + ((c as { endMinutes: number }).endMinutes - (c as { startMinutes: number }).startMinutes), 0);
    expect(placedMinutes).toBe(60);
  });

  it("reports a plain-English summary of what moved, and says nothing needed to move otherwise", () => {
    const untouched = closeGapsFrom({ anchor: { day: "2026-11-23", startMinutes: 570 }, days: FIVE_DAYS, blocks: [] });
    expect(untouched.summary).toBe("Nothing needed to move.");

    const moved = closeGapsFrom({
      anchor: { day: "2026-11-23", startMinutes: 570 },
      days: FIVE_DAYS,
      blocks: [block({ id: "a", day: "2026-11-23", startMinutes: 660, endMinutes: 720 })],
    });
    expect(moved.summary).toBe("Closed the gap — moved 1 task earlier.");
  });
});
