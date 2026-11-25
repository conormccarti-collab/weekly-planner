/**
 * Work-ahead-fill: when a week has slack, pull forward extra eligible work
 * instead of leaving it empty. Deliberately a thin wrapper around the same
 * engines the weekly build and Re-prioritise already use — no new packing
 * logic lives here.
 */
import { freeGapsForDay, obstacleRangesForDay, type DayShape, type ExistingBlock } from "@/lib/resolve-drop";
import { orderCandidatesForPlacement, proposeAutoPlacement, type AutoPlaceCandidate, type FreeBlock, type ProposedPlacement } from "@/lib/auto-placement";

/**
 * Every currently-placed block on `days` is treated as an obstacle,
 * regardless of pinned/done status — fillSlack only ever uses genuinely free
 * time, it never rearranges anything already on the calendar (that's what
 * Re-prioritise and the weekly build's own unprotected-row rebuild are for).
 */
export function freeBlocksFromCurrentPlacements(days: DayShape[], blocks: ExistingBlock[]): { freeBlocksByDay: Map<string, FreeBlock[]>; dayOrder: string[] } {
  const blocksByDay = new Map<string, ExistingBlock[]>();
  for (const b of blocks) {
    const list = blocksByDay.get(b.day) ?? [];
    list.push(b);
    blocksByDay.set(b.day, list);
  }

  const freeBlocksByDay = new Map<string, FreeBlock[]>();
  const dayOrder: string[] = [];
  for (const day of days) {
    if (!day.isWorkingDay) continue;
    dayOrder.push(day.day);
    const obstacles = obstacleRangesForDay(day, blocksByDay.get(day.day) ?? [], () => true);
    freeBlocksByDay.set(day.day, freeGapsForDay(day, obstacles));
  }
  return { freeBlocksByDay, dayOrder };
}

export type SlackFillResult = { placements: ProposedPlacement[]; filledHours: number };

/** Ranks `extraCandidates` the same way the weekly build does (orderCandidatesForPlacement) and places as many as fit into the given free blocks (proposeAutoPlacement) — a second, smaller placement pass over leftover capacity. */
export function computeSlackFill(extraCandidates: AutoPlaceCandidate[], freeBlocksByDay: Map<string, FreeBlock[]>, dayOrder: string[]): SlackFillResult {
  const ordered = orderCandidatesForPlacement(extraCandidates);
  const { placements } = proposeAutoPlacement(ordered, freeBlocksByDay, dayOrder);
  const filledHours = placements.reduce((sum, p) => sum + (p.endMinutes - p.startMinutes) / 60, 0);
  return { placements, filledHours };
}
