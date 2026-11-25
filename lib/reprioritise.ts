/**
 * The mirror image of resolveDrop's push-right cascade: instead of inserting
 * a block and pushing whatever's in the way later, this closes a gap by
 * pulling everything after it earlier, in chronological order. Backs two
 * user actions: "finish early" (the gap is whatever time the task saved)
 * and a day's "Re-prioritise" button (the gap is the whole rest of the day
 * sliding up to meet the anchor point).
 *
 * Confirmed design choices (asked directly, not assumed):
 * - Everything can move, including a block placed/edited by hand — "pinned"
 *   no longer means "never auto-move" now that dragging doesn't exist.
 *   Only a Done block, or a calendar meeting, is a fixed obstacle.
 * - This only closes the gap — it does not re-rank by Must/priority/due
 *   date, and does not pull in extra backlog work to fill freed time.
 */
import { packDuration, freeGapsForDay, obstacleRangesForDay, toPlacedChanges, type DayShape, type DropChange, type ExistingBlock } from "@/lib/resolve-drop";

export type CascadeInput = {
  anchor: { day: string; startMinutes: number };
  days: DayShape[];
  /** Every placed block across `days` that could be affected — same shape resolveDrop takes. */
  blocks: ExistingBlock[];
  minPartMinutes?: number;
};

export type CascadeResult = { changes: DropChange[]; summary: string };

const DEFAULT_MIN_PART_MINUTES = 60;

export function closeGapsFrom(input: CascadeInput): CascadeResult {
  const days = [...input.days].sort((a, b) => a.day.localeCompare(b.day));
  const anchorDayIndex = days.findIndex((d) => d.day === input.anchor.day);
  if (anchorDayIndex === -1) return { changes: [], summary: "Nothing to close." };

  const minPartMinutes = input.minPartMinutes ?? DEFAULT_MIN_PART_MINUTES;
  const isObstacle = (b: ExistingBlock) => b.done;

  const blocksByDay = new Map<string, ExistingBlock[]>();
  for (const b of input.blocks) {
    const list = blocksByDay.get(b.day) ?? [];
    list.push(b);
    blocksByDay.set(b.day, list);
  }
  for (const list of blocksByDay.values()) list.sort((a, b) => a.startMinutes - b.startMinutes);

  // Every movable block at/after the anchor, in chronological order — the
  // same "affected" construction resolveDrop uses for its own cascade.
  const affected: ExistingBlock[] = [];
  for (let i = anchorDayIndex; i < days.length; i++) {
    const day = days[i];
    for (const b of blocksByDay.get(day.day) ?? []) {
      if (isObstacle(b)) continue;
      if (i === anchorDayIndex && b.endMinutes <= input.anchor.startMinutes) continue;
      affected.push(b);
    }
  }

  const gapsByDay = new Map<string, ReturnType<typeof freeGapsForDay>>();
  for (const day of days) {
    gapsByDay.set(day.day, freeGapsForDay(day, obstacleRangesForDay(day, blocksByDay.get(day.day) ?? [], isObstacle)));
  }

  let cursorDay = input.anchor.day;
  let cursorMinutes = input.anchor.startMinutes;
  const changes: DropChange[] = [];
  const movedNames: string[] = [];

  for (const block of affected) {
    const noGapBeforeIt = block.day < cursorDay || (block.day === cursorDay && block.startMinutes <= cursorMinutes);
    if (noGapBeforeIt) {
      cursorDay = block.day;
      cursorMinutes = block.endMinutes;
      continue;
    }

    const duration = block.endMinutes - block.startMinutes;
    const { parts, leftoverMinutes } = packDuration(cursorDay, cursorMinutes, duration, days, gapsByDay, minPartMinutes);

    if (parts.length === 0) {
      // No earlier room at all — leave it exactly where it is rather than losing it.
      cursorDay = block.day;
      cursorMinutes = block.endMinutes;
      continue;
    }

    changes.push(...toPlacedChanges({ source: block.source, reference: block.reference, name: block.name }, block.id, block.pinned, parts));
    movedNames.push(block.name);

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
        reason: "Didn't fully fit after closing the gap — the rest needs a new slot",
      });
    }
  }

  const summary = movedNames.length > 0 ? `Closed the gap — moved ${movedNames.length} task${movedNames.length === 1 ? "" : "s"} earlier.` : "Nothing needed to move.";
  return { changes, summary };
}
