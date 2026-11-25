/**
 * v5 Stage 12g §A: "Insert-and-push." One pure function, resolveDrop,
 * drives both the live ripple preview while dragging and the real drop.
 *
 * Model: dropping a block at (day, startMinutes) claims that slot and pins
 * it. Everything "affected" — any not-pinned, not-done block that finishes
 * after the drop point, read in original chronological order across the
 * supplied days — is walked with a single forward cursor. A block already
 * sitting at or after the cursor doesn't move (there's already a natural
 * gap); a block the cursor has caught up to is pushed to start exactly at
 * the cursor, split across whichever days/gaps it takes to fit its full
 * duration without crossing a meeting, the break, a pinned block or a Done
 * block (all of which never move). Nothing before the drop point is ever
 * touched, and nothing is pulled backward to fill a gap left behind.
 *
 * Dropping directly onto a meeting, a pinned block or a Done block is a
 * different case — those never move at all. The dropped block is redirected
 * to the nearest genuinely free slot, or split across whatever free gaps
 * exist, unless the caller passes replace (only ever in response to an
 * explicit "Replace" confirmation), which demotes that one block into the
 * ordinary cascade above instead.
 */

import { formatHHMM } from "@/lib/time";
import { packAcrossGaps, snapTo15, type DayGap, type Range } from "@/lib/blocks";

export type Source = "asana" | "personal";

export type ExistingBlock = {
  id: string;
  source: Source;
  reference: string;
  name: string;
  day: string;
  startMinutes: number;
  endMinutes: number;
  pinned: boolean;
  done: boolean;
};

export type DayShape = {
  day: string;
  windowStartMinutes: number;
  windowEndMinutes: number;
  /** Calendar-free time within the window — meetings and the break already excluded. */
  calendarFreeBlocks: Range[];
  isWorkingDay: boolean;
};

export type MovingBlock = {
  id: string | null;
  source: Source;
  reference: string;
  name: string;
  durationMinutes: number;
};

export type DropTarget = { day: string; startMinutes: number };

export type PlacedChange = {
  kind: "placed";
  blockId: string | null;
  source: Source;
  reference: string;
  name: string;
  day: string;
  startMinutes: number;
  endMinutes: number;
  pinned: boolean;
  partIndex?: number;
  partCount?: number;
};

export type UnplacedChange = {
  kind: "unplaced";
  blockId: string;
  source: Source;
  reference: string;
  name: string;
  reason: string;
};

export type DropChange = PlacedChange | UnplacedChange;

export type ResolveDropResult =
  | { ok: true; changes: DropChange[]; summary: string }
  | { ok: false; reason: string; needsReplaceConfirmation?: { blockId: string; name: string } };

export type ResolveDropInput = {
  moving: MovingBlock;
  target: DropTarget;
  /** Chronologically ordered, starting no later than target.day. Must cover every day the drop could possibly overflow into. */
  days: DayShape[];
  /** Every other currently-placed block across `days` — must exclude `moving` itself. */
  blocks: ExistingBlock[];
  /** Only true right after the user confirms "Replace" on the pinned/Done block named in a prior needsReplaceConfirmation result. */
  replaceBlockId?: string;
  minPartMinutes?: number;
};

const DEFAULT_MIN_PART_MINUTES = 60;

function mergeRanges(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a.startMinutes - b.startMinutes);
  const merged: Range[] = [];
  for (const r of sorted) {
    if (r.endMinutes <= r.startMinutes) continue;
    const last = merged[merged.length - 1];
    if (last && r.startMinutes <= last.endMinutes) {
      last.endMinutes = Math.max(last.endMinutes, r.endMinutes);
    } else {
      merged.push({ ...r });
    }
  }
  return merged;
}

function subtractFromWindow(window: Range, blocked: Range[]): Range[] {
  const merged = mergeRanges(blocked);
  const gaps: Range[] = [];
  let cursor = window.startMinutes;
  for (const b of merged) {
    const start = Math.max(b.startMinutes, window.startMinutes);
    const end = Math.min(b.endMinutes, window.endMinutes);
    if (start >= end) continue;
    if (start > cursor) gaps.push({ startMinutes: cursor, endMinutes: start });
    cursor = Math.max(cursor, end);
  }
  if (cursor < window.endMinutes) gaps.push({ startMinutes: cursor, endMinutes: window.endMinutes });
  return gaps.filter((g) => g.endMinutes > g.startMinutes);
}

export type Part = { day: string; startMinutes: number; endMinutes: number };

/**
 * Builds the ordered gap list forward from (startDay, startMinutes) across
 * `days`, then hands off to the shared packAcrossGaps (lib/blocks.ts) to
 * actually fill the duration. The first day's gaps are floored at
 * `startMinutes` — nothing before that point is ever offered up.
 */
export function packDuration(
  startDay: string,
  startMinutes: number,
  durationMinutes: number,
  days: DayShape[],
  gapsByDay: Map<string, Range[]>,
  minPartMinutes: number
): { parts: Part[]; leftoverMinutes: number } {
  const startIndex = days.findIndex((d) => d.day === startDay);
  if (startIndex === -1) return { parts: [], leftoverMinutes: durationMinutes };

  const orderedGaps: DayGap[] = [];
  for (let i = startIndex; i < days.length; i++) {
    const day = days[i];
    if (!day.isWorkingDay) continue;
    const floor = i === startIndex ? startMinutes : day.windowStartMinutes;
    for (const gap of gapsByDay.get(day.day) ?? []) {
      const usableStart = Math.max(gap.startMinutes, floor);
      if (gap.endMinutes <= usableStart) continue;
      orderedGaps.push({ day: day.day, startMinutes: usableStart, endMinutes: gap.endMinutes });
    }
  }

  return packAcrossGaps(durationMinutes, orderedGaps, minPartMinutes);
}

export function obstacleRangesForDay(
  day: DayShape,
  blocksOnDay: ExistingBlock[],
  predicate: (b: ExistingBlock) => boolean
): Range[] {
  const meetings = subtractFromWindow(
    { startMinutes: day.windowStartMinutes, endMinutes: day.windowEndMinutes },
    day.calendarFreeBlocks
  );
  const others = blocksOnDay
    .filter(predicate)
    .map((b) => ({ startMinutes: b.startMinutes, endMinutes: b.endMinutes }));
  return mergeRanges([...meetings, ...others]);
}

/** Whole calendar days from `fromDateStr` to `toDateStr` (positive when `toDateStr` is later) — plain ISO-date arithmetic, no timezone involved. */
function dayDistance(fromDateStr: string, toDateStr: string): number {
  const toUtc = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(toDateStr) - toUtc(fromDateStr)) / (24 * 60 * 60 * 1000));
}

export function freeGapsForDay(day: DayShape, obstacles: Range[]): Range[] {
  return subtractFromWindow({ startMinutes: day.windowStartMinutes, endMinutes: day.windowEndMinutes }, obstacles);
}

function rangesOverlap(a: Range, b: Range): boolean {
  return a.startMinutes < b.endMinutes && a.endMinutes > b.startMinutes;
}

export function toPlacedChanges(
  moving: Pick<MovingBlock, "source" | "reference" | "name">,
  blockId: string | null,
  pinned: boolean,
  parts: Part[]
): PlacedChange[] {
  return parts.map((p, i) => ({
    kind: "placed",
    blockId: i === 0 ? blockId : null,
    source: moving.source,
    reference: moving.reference,
    name: moving.name,
    day: p.day,
    startMinutes: p.startMinutes,
    endMinutes: p.endMinutes,
    pinned,
    ...(parts.length > 1 ? { partIndex: i + 1, partCount: parts.length } : {}),
  }));
}

export function resolveDrop(input: ResolveDropInput): ResolveDropResult {
  const minPartMinutes = input.minPartMinutes ?? DEFAULT_MIN_PART_MINUTES;
  const days = [...input.days].sort((a, b) => a.day.localeCompare(b.day));
  const targetDayIndex = days.findIndex((d) => d.day === input.target.day);
  if (targetDayIndex === -1) {
    return { ok: false, reason: "That day isn't available to plan into" };
  }
  const targetDay = days[targetDayIndex];
  const startMinutes = snapTo15(input.target.startMinutes);
  const endMinutes = startMinutes + input.moving.durationMinutes;
  const targetRange: Range = { startMinutes, endMinutes };

  if (endMinutes - startMinutes <= 0) {
    return { ok: false, reason: "That slot isn't free" };
  }

  const blocksByDay = new Map<string, ExistingBlock[]>();
  for (const b of input.blocks) {
    const list = blocksByDay.get(b.day) ?? [];
    list.push(b);
    blocksByDay.set(b.day, list);
  }
  for (const list of blocksByDay.values()) list.sort((a, b) => a.startMinutes - b.startMinutes);

  const isDemoted = (b: ExistingBlock) => input.replaceBlockId != null && b.id === input.replaceBlockId;
  const isObstacle = (b: ExistingBlock) => (b.pinned || b.done) && !isDemoted(b);

  const targetDayBlocks = blocksByDay.get(targetDay.day) ?? [];
  const conflictingObstacle = targetDayBlocks.find((b) => isObstacle(b) && rangesOverlap(targetRange, b));
  const meetingObstacles = subtractFromWindow(
    { startMinutes: targetDay.windowStartMinutes, endMinutes: targetDay.windowEndMinutes },
    targetDay.calendarFreeBlocks
  );
  const conflictingMeeting = meetingObstacles.find((m) => rangesOverlap(targetRange, m));

  if (conflictingObstacle || conflictingMeeting) {
    // Redirect: find genuinely free time (every other block, movable or
    // not, counts as occupied here) — never ripple, never displace.
    const literalGapsByDay = new Map<string, Range[]>();
    for (const day of days) {
      const dayBlocks = (blocksByDay.get(day.day) ?? []).filter((b) => !isDemoted(b));
      literalGapsByDay.set(
        day.day,
        freeGapsForDay(day, obstacleRangesForDay(day, dayBlocks, () => true))
      );
    }

    // "The nearest free slot" — searched by calendar-day distance from the
    // drop point (same day first, then the closest adjacent day on either
    // side, and so on), not just forward-chronological across the whole
    // horizon. A tie between an earlier and a later day at the same
    // distance prefers the later one.
    const daysByNearness = [...days].sort((a, b) => {
      const distanceDiff = Math.abs(dayDistance(targetDay.day, a.day)) - Math.abs(dayDistance(targetDay.day, b.day));
      if (distanceDiff !== 0) return distanceDiff;
      const aForward = a.day >= targetDay.day;
      const bForward = b.day >= targetDay.day;
      if (aForward !== bForward) return aForward ? -1 : 1;
      return a.day.localeCompare(b.day);
    });
    for (const day of daysByNearness) {
      // Same clock time is the anchor on every candidate day, same as the
      // original click position would be on the target day itself.
      const nearestStart = findNearestFreeStart(startMinutes, input.moving.durationMinutes, literalGapsByDay.get(day.day) ?? []);
      if (nearestStart == null) continue;
      const parts: Part[] = [{ day: day.day, startMinutes: nearestStart, endMinutes: nearestStart + input.moving.durationMinutes }];
      return {
        ok: true,
        changes: toPlacedChanges(input.moving, input.moving.id, true, parts),
        summary: describeRedirect(input.moving.name, parts[0]),
      };
    }

    // Unlike the ripple cascade, nothing here is "before the drop point" —
    // we're searching the whole day (and beyond) for genuinely free space,
    // so the first day isn't floored at the click position.
    const { parts, leftoverMinutes } = packDuration(
      targetDay.day,
      targetDay.windowStartMinutes,
      input.moving.durationMinutes,
      days,
      literalGapsByDay,
      minPartMinutes
    );
    if (parts.length > 0 && leftoverMinutes === 0) {
      return {
        ok: true,
        changes: toPlacedChanges(input.moving, input.moving.id, true, parts),
        summary: describeSplit(input.moving.name, parts),
      };
    }

    const obstacleBlock = conflictingObstacle;
    if (obstacleBlock) {
      return {
        ok: false,
        reason: `${obstacleBlock.done ? "That block is marked Done" : "That block is pinned"} — "${obstacleBlock.name}" can't be moved out of the way`,
        needsReplaceConfirmation: { blockId: obstacleBlock.id, name: obstacleBlock.name },
      };
    }
    return { ok: false, reason: `Overlaps a meeting at ${formatRangeLabel(conflictingMeeting!)}` };
  }

  // Ordinary ripple: place the dropped block, then cascade everything
  // (not pinned, not Done — a demoted Replace target counts as movable too)
  // that finishes after the drop point.
  const affected: ExistingBlock[] = [];
  for (let i = targetDayIndex; i < days.length; i++) {
    const day = days[i];
    const dayBlocks = blocksByDay.get(day.day) ?? [];
    for (const b of dayBlocks) {
      if (isObstacle(b)) continue;
      if (i === targetDayIndex && b.endMinutes <= startMinutes) continue;
      affected.push(b);
    }
  }
  // Already sorted by day (outer loop) then startMinutes (inner list).

  const gapsByDay = new Map<string, Range[]>();
  for (const day of days) {
    gapsByDay.set(day.day, freeGapsForDay(day, obstacleRangesForDay(day, blocksByDay.get(day.day) ?? [], isObstacle)));
  }

  // The dropped block itself is packed the same way a pushed block is below
  // — measured out from the drop point, jumping only over fixed obstacles
  // (pinned/Done/meetings/the break), never a movable block (those are
  // exactly what `affected` pushes out of its way next). Previously this
  // placed one unclipped [startMinutes, startMinutes + duration) range with
  // no check against the day's end at all, so a block longer than the time
  // left today just rendered past the bottom of the grid instead of
  // continuing into tomorrow.
  const { parts: movingParts, leftoverMinutes: movingLeftover } = packDuration(
    targetDay.day,
    startMinutes,
    input.moving.durationMinutes,
    days,
    gapsByDay,
    minPartMinutes
  );

  if (movingParts.length === 0) {
    return { ok: false, reason: "No room left this week for a block that size" };
  }

  const changes: DropChange[] = toPlacedChanges(input.moving, input.moving.id, true, movingParts);
  if (movingLeftover > 0) {
    changes.push({
      kind: "unplaced",
      blockId: input.moving.id ?? "",
      source: input.moving.source,
      reference: input.moving.reference,
      name: input.moving.name,
      reason: "Didn't fully fit — the rest needs a new slot",
    });
  }

  const movingLast = movingParts[movingParts.length - 1];
  let cursorDay = movingLast.day;
  let cursorMinutes = movingLast.endMinutes;
  const pushedNames: string[] = [];
  const splitNames: string[] = [];
  const unplacedNames: string[] = [];

  for (const block of affected) {
    const blockIsAtOrAfterCursor =
      block.day > cursorDay || (block.day === cursorDay && block.startMinutes >= cursorMinutes);
    if (blockIsAtOrAfterCursor) {
      cursorDay = block.day;
      cursorMinutes = block.endMinutes;
      continue;
    }

    const duration = block.endMinutes - block.startMinutes;
    const { parts, leftoverMinutes } = packDuration(cursorDay, cursorMinutes, duration, days, gapsByDay, minPartMinutes);

    if (parts.length === 0) {
      changes.push({ kind: "unplaced", blockId: block.id, source: block.source, reference: block.reference, name: block.name, reason: "Pushed off the end of the week by another move" });
      unplacedNames.push(block.name);
      continue;
    }

    changes.push(...toPlacedChanges(block, block.id, block.pinned && isDemoted(block) ? false : block.pinned, parts));
    if (parts.length > 1) splitNames.push(block.name);
    else pushedNames.push(block.name);

    const last = parts[parts.length - 1];
    cursorDay = last.day;
    cursorMinutes = last.endMinutes;

    if (leftoverMinutes > 0) {
      changes.push({
        kind: "unplaced",
        blockId: block.id,
        source: block.source,
        reference: block.reference,
        name: block.name,
        reason: "Didn't fully fit after being pushed — the rest needs a new slot",
      });
      unplacedNames.push(block.name);
    }
  }

  return {
    ok: true,
    changes,
    summary: describeRipple(input.moving.name, movingParts, pushedNames, splitNames, unplacedNames),
  };
}

function findNearestFreeStart(rawStart: number, durationMinutes: number, gaps: Range[]): number | null {
  let best: number | null = null;
  let bestDistance = Infinity;
  for (const gap of gaps) {
    if (gap.endMinutes - gap.startMinutes < durationMinutes) continue;
    const maxStart = gap.endMinutes - durationMinutes;
    const clamped = Math.max(gap.startMinutes, Math.min(snapTo15(rawStart), maxStart));
    const distance = Math.abs(clamped - rawStart);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = clamped;
    }
  }
  return best;
}

function formatRangeLabel(r: Range): string {
  return `${formatHHMM(r.startMinutes)}–${formatHHMM(r.endMinutes)}`;
}

function describeRedirect(name: string, part: Part): string {
  return `${name} moved to the nearest free slot, ${part.day} ${formatRangeLabel(part)} — the spot you dropped it on can't be moved.`;
}

function describeSplit(name: string, parts: Part[]): string {
  return `${name} split into ${parts.length} parts across ${parts[0].day}–${parts[parts.length - 1].day} to fit around what's pinned there.`;
}

function describeRipple(
  name: string,
  movingParts: Part[],
  pushed: string[],
  split: string[],
  unplaced: string[]
): string {
  const movedBit =
    movingParts.length > 1
      ? `Split ${name} into ${movingParts.length} parts across ${movingParts[0].day}–${movingParts[movingParts.length - 1].day}.`
      : `Moved ${name} to ${movingParts[0].day} ${formatRangeLabel(movingParts[0])}.`;
  const bits: string[] = [movedBit];
  if (pushed.length > 0) bits.push(`Pushed ${pushed.length} task${pushed.length === 1 ? "" : "s"} later (${pushed.join(", ")}).`);
  if (split.length > 0) bits.push(`Split ${split.join(", ")} across days to make room.`);
  if (unplaced.length > 0) bits.push(`Couldn't fit ${unplaced.join(", ")} — moved to Unplaced.`);
  return bits.join(" ");
}
