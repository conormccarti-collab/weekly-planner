import { describe, expect, it } from "vitest";
import { resolveDrop, type DayShape, type ExistingBlock, type ResolveDropInput } from "@/lib/resolve-drop";

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

const FIVE_DAYS = ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27"];

function baseInput(overrides: Partial<ResolveDropInput> = {}): ResolveDropInput {
  return {
    moving: { id: "dragged", source: "personal", reference: "dragged", name: "Dragged Task", durationMinutes: 60 },
    target: { day: "2026-11-23", startMinutes: 600 },
    days: FIVE_DAYS.map((d) => day(d)),
    blocks: [],
    ...overrides,
  };
}

describe("resolveDrop — basic placement", () => {
  it("places the dropped block at the target, pinned, with no other blocks on the calendar", () => {
    const result = resolveDrop(baseInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changes).toEqual([
      expect.objectContaining({ kind: "placed", blockId: "dragged", day: "2026-11-23", startMinutes: 600, endMinutes: 660, pinned: true }),
    ]);
  });

  it("does not move a block that sits entirely before the drop point, same day", () => {
    const before = block({ id: "before", day: "2026-11-23", startMinutes: 540, endMinutes: 600 });
    const result = resolveDrop(baseInput({ blocks: [before] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changes.filter((c) => c.kind === "placed" && c.reference === "before")).toEqual([]);
  });

  it("does not move a block on an earlier day at all", () => {
    const yesterday = block({ id: "yesterday", day: "2026-11-22" as string, startMinutes: 540, endMinutes: 600 });
    const result = resolveDrop(baseInput({ blocks: [yesterday], days: [day("2026-11-22"), ...FIVE_DAYS.map((d) => day(d))] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changes.some((c) => c.kind === "placed" && c.reference === "yesterday")).toBe(false);
  });

  it("splits the dropped block itself into the next day when it runs past the end of today, with nothing else on the calendar in its way", () => {
    // Window is 09:00–17:00. Dropped at 15:00 for 3h would run to 18:00 —
    // 1h past the end of the day — on an otherwise completely empty
    // calendar. Previously this rendered one unclipped 15:00–18:00 block
    // instead of continuing into tomorrow.
    const result = resolveDrop(
      baseInput({ target: { day: "2026-11-23", startMinutes: 900 }, moving: { id: "dragged", source: "personal", reference: "dragged", name: "Dragged", durationMinutes: 180 } })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parts = result.changes.filter((c) => c.kind === "placed" && c.reference === "dragged");
    expect(parts).toEqual([
      expect.objectContaining({ day: "2026-11-23", startMinutes: 900, endMinutes: 1020, partIndex: 1, partCount: 2 }),
      expect.objectContaining({ day: "2026-11-24", startMinutes: 540, endMinutes: 600, partIndex: 2, partCount: 2 }),
    ]);
  });
});

describe("resolveDrop — ripple push", () => {
  it("pushes a single movable block later by the dropped block's duration", () => {
    const after = block({ id: "after", day: "2026-11-23", startMinutes: 600, endMinutes: 660 });
    const result = resolveDrop(baseInput({ blocks: [after] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const pushed = result.changes.find((c) => c.kind === "placed" && c.reference === "after");
    expect(pushed).toMatchObject({ day: "2026-11-23", startMinutes: 660, endMinutes: 720 });
  });

  it("leaves a block alone if there's already enough natural gap after the drop", () => {
    const far = block({ id: "far", day: "2026-11-23", startMinutes: 900, endMinutes: 960 });
    const result = resolveDrop(baseInput({ blocks: [far] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changes.some((c) => c.kind === "placed" && c.reference === "far")).toBe(false);
  });

  it("cascades through a chain of back-to-back blocks", () => {
    const a = block({ id: "a", day: "2026-11-23", startMinutes: 600, endMinutes: 660 });
    const b = block({ id: "b", day: "2026-11-23", startMinutes: 660, endMinutes: 720 });
    const result = resolveDrop(baseInput({ blocks: [a, b] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changes.find((c) => c.kind === "placed" && c.reference === "a")).toMatchObject({ startMinutes: 660, endMinutes: 720 });
    expect(result.changes.find((c) => c.kind === "placed" && c.reference === "b")).toMatchObject({ startMinutes: 720, endMinutes: 780 });
  });

  it("leaves the gap behind when the moving block came from later that day — nothing is pulled back", () => {
    // The moving block itself is excluded from `blocks` (its old row is a separate change the caller applies).
    const other = block({ id: "other", day: "2026-11-23", startMinutes: 780, endMinutes: 840 });
    const result = resolveDrop(baseInput({ target: { day: "2026-11-23", startMinutes: 600 }, blocks: [other] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // `other` is already past the pushed cursor (660), so it doesn't move at all —
    // and nothing fills 660-780 either, since nothing pulls backward.
    expect(result.changes.some((c) => c.kind === "placed" && c.reference === "other")).toBe(false);
  });
});

describe("resolveDrop — obstacles are never moved", () => {
  it("jumps a pushed block over a meeting", () => {
    const meeting = day("2026-11-23", { calendarFreeBlocks: [{ startMinutes: 540, endMinutes: 700 }, { startMinutes: 730, endMinutes: 1020 }] });
    const pushedBlock = block({ id: "pushed", day: "2026-11-23", startMinutes: 600, endMinutes: 660 });
    const result = resolveDrop(baseInput({ days: [meeting, ...FIVE_DAYS.slice(1).map((d) => day(d))], blocks: [pushedBlock], minPartMinutes: 15 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Dropped block takes 600-660. Pushed block wants 660-720, but 700-730 is a meeting,
    // so it must split: 660-700 (40m) then 730-750 (20m).
    const parts = result.changes.filter((c) => c.kind === "placed" && c.reference === "pushed");
    expect(parts.length).toBe(2);
    expect(parts[0]).toMatchObject({ startMinutes: 660, endMinutes: 700, partIndex: 1, partCount: 2 });
    expect(parts[1]).toMatchObject({ startMinutes: 730, endMinutes: 750, partIndex: 2, partCount: 2 });
  });

  it("jumps a pushed block over a pinned block without moving it", () => {
    const pinned = block({ id: "pinned", day: "2026-11-23", startMinutes: 660, endMinutes: 690, pinned: true });
    const pushedBlock = block({ id: "pushed", day: "2026-11-23", startMinutes: 600, endMinutes: 660 });
    const result = resolveDrop(baseInput({ blocks: [pinned, pushedBlock] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changes.some((c) => c.kind === "placed" && c.reference === "pinned")).toBe(false);
    const parts = result.changes.filter((c) => c.kind === "placed" && c.reference === "pushed");
    // 660-720 wanted, but 660-690 is pinned: splits to 690-750.
    expect(parts).toEqual([expect.objectContaining({ startMinutes: 690, endMinutes: 750 })]);
  });

  it("jumps a pushed block over a Done block regardless of its pinned flag", () => {
    const done = block({ id: "done", day: "2026-11-23", startMinutes: 660, endMinutes: 690, pinned: false, done: true });
    const pushedBlock = block({ id: "pushed", day: "2026-11-23", startMinutes: 600, endMinutes: 660 });
    const result = resolveDrop(baseInput({ blocks: [done, pushedBlock] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changes.some((c) => c.kind === "placed" && c.reference === "done")).toBe(false);
    const parts = result.changes.filter((c) => c.kind === "placed" && c.reference === "pushed");
    expect(parts).toEqual([expect.objectContaining({ startMinutes: 690, endMinutes: 750 })]);
  });

  it("jumps over the break the same way it jumps a meeting, since the break is already excluded from calendarFreeBlocks", () => {
    const withLunch = day("2026-11-23", { calendarFreeBlocks: [{ startMinutes: 540, endMinutes: 690 }, { startMinutes: 750, endMinutes: 1020 }] });
    const pushedBlock = block({ id: "pushed", day: "2026-11-23", startMinutes: 600, endMinutes: 660 });
    const result = resolveDrop(baseInput({ days: [withLunch, ...FIVE_DAYS.slice(1).map((d) => day(d))], blocks: [pushedBlock], minPartMinutes: 15 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parts = result.changes.filter((c) => c.kind === "placed" && c.reference === "pushed");
    expect(parts[0]).toMatchObject({ startMinutes: 660, endMinutes: 690 });
    expect(parts[1]).toMatchObject({ startMinutes: 750, endMinutes: 780 });
  });
});

describe("resolveDrop — overflow across days and weeks", () => {
  it("overflows a pushed block into the next working day when today runs out of room", () => {
    const nearEndOfDay = block({ id: "tail", day: "2026-11-23", startMinutes: 990, endMinutes: 1020 });
    const result = resolveDrop(
      baseInput({ target: { day: "2026-11-23", startMinutes: 960 }, blocks: [nearEndOfDay], moving: { id: "dragged", source: "personal", reference: "dragged", name: "Dragged", durationMinutes: 60 } })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parts = result.changes.filter((c) => c.kind === "placed" && c.reference === "tail");
    expect(parts).toEqual([expect.objectContaining({ day: "2026-11-24", startMinutes: 540, endMinutes: 570 })]);
  });

  it("unplaces whatever still doesn't fit after exhausting every supplied day", () => {
    const shortWeek = [day("2026-11-23")];
    const nearEndOfDay = block({ id: "tail", day: "2026-11-23", startMinutes: 990, endMinutes: 1020 });
    const result = resolveDrop(
      baseInput({ days: shortWeek, target: { day: "2026-11-23", startMinutes: 960 }, blocks: [nearEndOfDay] })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changes.some((c) => c.kind === "unplaced" && c.reference === "tail")).toBe(true);
  });

  it("skips a non-working day while overflowing", () => {
    const nearEndOfDay = block({ id: "tail", day: "2026-11-23", startMinutes: 990, endMinutes: 1020 });
    const days = [day("2026-11-23"), day("2026-11-24", { isWorkingDay: false }), day("2026-11-25")];
    const result = resolveDrop(baseInput({ days, target: { day: "2026-11-23", startMinutes: 960 }, blocks: [nearEndOfDay] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parts = result.changes.filter((c) => c.kind === "placed" && c.reference === "tail");
    expect(parts).toEqual([expect.objectContaining({ day: "2026-11-25" })]);
  });
});

describe("resolveDrop — dropping onto a pinned/Done block", () => {
  it("redirects to the nearest free slot on the same day without displacing the pinned block", () => {
    const pinned = block({ id: "pinned", day: "2026-11-23", startMinutes: 600, endMinutes: 660, pinned: true });
    const result = resolveDrop(baseInput({ target: { day: "2026-11-23", startMinutes: 610 }, blocks: [pinned] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changes).toEqual([
      expect.objectContaining({ kind: "placed", reference: "dragged", day: "2026-11-23", pinned: true }),
    ]);
    const placed = result.changes[0] as { startMinutes: number; endMinutes: number };
    expect(placed.startMinutes >= 660 || placed.endMinutes <= 600).toBe(true);
    expect(result.changes.some((c) => c.kind === "placed" && c.reference === "pinned")).toBe(false);
  });

  it("redirects to the nearest free slot without displacing a Done block", () => {
    const done = block({ id: "done", day: "2026-11-23", startMinutes: 600, endMinutes: 660, done: true });
    const result = resolveDrop(baseInput({ target: { day: "2026-11-23", startMinutes: 610 }, blocks: [done] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changes.some((c) => c.kind === "placed" && c.reference === "done")).toBe(false);
  });

  it("splits the dropped block across free gaps when no single nearby slot fits it whole, anywhere", () => {
    // Only 30m before the pinned block and 30m after it, but the dropped
    // task needs 60m — scoped to just this one day, or the nearest-day
    // search below would (correctly) just use next door's wide-open day
    // instead of splitting around this one's pinned block.
    const pinned = block({ id: "pinned", day: "2026-11-23", startMinutes: 570, endMinutes: 990, pinned: true });
    const result = resolveDrop(
      baseInput({
        days: [day("2026-11-23")],
        target: { day: "2026-11-23", startMinutes: 600 },
        blocks: [pinned],
        minPartMinutes: 15,
      })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parts = result.changes.filter((c) => c.kind === "placed" && c.reference === "dragged");
    expect(parts.length).toBe(2);
    expect(parts[0]).toMatchObject({ startMinutes: 540, endMinutes: 570, partIndex: 1, partCount: 2 });
    expect(parts[1]).toMatchObject({ startMinutes: 990, endMinutes: 1020, partIndex: 2, partCount: 2 });
  });

  it("asks for Replace confirmation when the pinned block truly can't be avoided", () => {
    const pinned = block({ id: "pinned", day: "2026-11-23", startMinutes: 540, endMinutes: 1020, pinned: true });
    const result = resolveDrop(baseInput({ days: [day("2026-11-23")], target: { day: "2026-11-23", startMinutes: 600 }, blocks: [pinned] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.needsReplaceConfirmation).toEqual({ blockId: "pinned", name: "pinned" });
  });

  it("with Replace confirmed, demotes the pinned block into the ordinary ripple", () => {
    const pinned = block({ id: "pinned", day: "2026-11-23", startMinutes: 600, endMinutes: 660, pinned: true });
    const result = resolveDrop(baseInput({ target: { day: "2026-11-23", startMinutes: 600 }, blocks: [pinned], replaceBlockId: "pinned" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const dropped = result.changes.find((c) => c.kind === "placed" && c.reference === "dragged");
    expect(dropped).toMatchObject({ startMinutes: 600, endMinutes: 660 });
    const demoted = result.changes.find((c) => c.kind === "placed" && c.reference === "pinned");
    expect(demoted).toMatchObject({ startMinutes: 660, endMinutes: 720, pinned: false });
  });

  it("picks the nearest free slot by calendar-day distance, not the first one found scanning forward", () => {
    // Monday (target) and Tuesday are both pinned solid; Wednesday (distance
    // 2) is wide open. The old forward-scan behaviour also lands here, but
    // the next test (same distance either side) is what actually
    // distinguishes "distance-ordered" from "forward-chronological".
    const pinnedMon = block({ id: "pinnedMon", day: "2026-11-23", startMinutes: 540, endMinutes: 1020, pinned: true });
    const pinnedTue = block({ id: "pinnedTue", day: "2026-11-24", startMinutes: 540, endMinutes: 1020, pinned: true });
    const result = resolveDrop(
      baseInput({
        days: [day("2026-11-23"), day("2026-11-24"), day("2026-11-25")],
        target: { day: "2026-11-23", startMinutes: 600 },
        blocks: [pinnedMon, pinnedTue],
      })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const dropped = result.changes.find((c) => c.kind === "placed" && c.reference === "dragged");
    expect(dropped).toMatchObject({ day: "2026-11-25", startMinutes: 600, endMinutes: 660 });
  });

  it("prefers the later day over the earlier one when both are equally near", () => {
    // Sunday (distance -1) and Tuesday (distance +1) are both wide open;
    // only Monday (the target) is blocked. A same-distance tie must not be
    // resolved by scan order — it must deliberately prefer forward in time.
    const pinnedMon = block({ id: "pinnedMon", day: "2026-11-23", startMinutes: 540, endMinutes: 1020, pinned: true });
    const result = resolveDrop(
      baseInput({
        days: [day("2026-11-22"), day("2026-11-23"), day("2026-11-24")],
        target: { day: "2026-11-23", startMinutes: 600 },
        blocks: [pinnedMon],
      })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const dropped = result.changes.find((c) => c.kind === "placed" && c.reference === "dragged");
    expect(dropped).toMatchObject({ day: "2026-11-24", startMinutes: 600, endMinutes: 660 });
  });
});

describe("resolveDrop — conservation of hours across a multi-day split", () => {
  it("a 28-hour task pushed into a tight week ends up fully placed or fully accounted for in Unplaced", () => {
    const bigMove: ResolveDropInput = {
      moving: { id: "big", source: "asana", reference: "big", name: "Big Edit", durationMinutes: 28 * 60 },
      target: { day: "2026-11-23", startMinutes: 540 },
      days: FIVE_DAYS.map((d) => day(d)), // 8h/day * 5 = 40h capacity
      blocks: [],
    };
    const result = resolveDrop(bigMove);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const placedMinutes = result.changes
      .filter((c) => c.kind === "placed" && c.reference === "big")
      .reduce((sum, c) => sum + ((c as { endMinutes: number }).endMinutes - (c as { startMinutes: number }).startMinutes), 0);
    expect(placedMinutes).toBe(28 * 60);
  });

  it("conserves hours when the overflow itself has to split across an obstacle", () => {
    const meetingDay = day("2026-11-24", { calendarFreeBlocks: [{ startMinutes: 540, endMinutes: 700 }, { startMinutes: 730, endMinutes: 1020 }] });
    const nearEndOfDay = block({ id: "tail", day: "2026-11-23", startMinutes: 940, endMinutes: 1020 });
    const result = resolveDrop(
      baseInput({
        days: [day("2026-11-23"), meetingDay, day("2026-11-25")],
        target: { day: "2026-11-23", startMinutes: 900 },
        blocks: [nearEndOfDay],
        moving: { id: "dragged", source: "personal", reference: "dragged", name: "Dragged", durationMinutes: 80 },
      })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tailMinutes = result.changes
      .filter((c) => c.kind === "placed" && c.reference === "tail")
      .reduce((sum, c) => sum + ((c as { endMinutes: number }).endMinutes - (c as { startMinutes: number }).startMinutes), 0);
    expect(tailMinutes).toBe(80);
  });
});
