import { formatHHMM } from "@/lib/time";

export type Range = { startMinutes: number; endMinutes: number };

export type BlockRef = Range & {
  id: string;
  source: string;
  reference: string;
  day: string;
};

export function snapTo15(minutes: number): number {
  return Math.round(minutes / 15) * 15;
}

/** A range is placeable only when it sits entirely inside a single free block. */
export function rangeFitsInFreeBlocks(range: Range, freeBlocks: Range[]): boolean {
  if (range.endMinutes <= range.startMinutes) return false;
  return freeBlocks.some(
    (block) => range.startMinutes >= block.startMinutes && range.endMinutes <= block.endMinutes
  );
}

function mergeRanges(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a.startMinutes - b.startMinutes);
  const merged: Range[] = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && r.startMinutes <= last.endMinutes) {
      last.endMinutes = Math.max(last.endMinutes, r.endMinutes);
    } else {
      merged.push({ ...r });
    }
  }
  return merged;
}

/**
 * The calendar-free blocks for a day, minus whatever's already occupied by
 * other placed blocks — a single-column calendar can't stack two tasks in
 * the same slot.
 */
export function subtractOccupied(freeBlocks: Range[], occupied: Range[]): Range[] {
  const blocked = mergeRanges(occupied);
  const result: Range[] = [];
  for (const free of freeBlocks) {
    let cursor = free.startMinutes;
    for (const block of blocked) {
      const start = Math.max(block.startMinutes, free.startMinutes);
      const end = Math.min(block.endMinutes, free.endMinutes);
      if (start >= end) continue;
      if (start > cursor) result.push({ startMinutes: cursor, endMinutes: start });
      cursor = Math.max(cursor, end);
    }
    if (cursor < free.endMinutes) result.push({ startMinutes: cursor, endMinutes: free.endMinutes });
  }
  return result.filter((r) => r.endMinutes > r.startMinutes);
}

/** The gaps between a day's free blocks and its working window — i.e. what's actually blocking it (meetings, mostly). */
export function complementRanges(windowStart: number, windowEnd: number, freeBlocks: Range[]): Range[] {
  const bands: Range[] = [];
  let cursor = windowStart;
  for (const free of [...freeBlocks].sort((a, b) => a.startMinutes - b.startMinutes)) {
    if (free.startMinutes > cursor) bands.push({ startMinutes: cursor, endMinutes: free.startMinutes });
    cursor = Math.max(cursor, free.endMinutes);
  }
  if (cursor < windowEnd) bands.push({ startMinutes: cursor, endMinutes: windowEnd });
  return bands;
}

/**
 * v5 (drag bug fix): "while dragging, free slots are highlighted and the
 * block snaps to the nearest free slot." Finds the closest valid start time
 * to `rawStartMinutes` across every free block that can actually fit the
 * duration — never a slot that would spill into a meeting or another task,
 * which the raw (unsnapped) pointer position easily lands on. Returns null
 * only when nothing in the day can fit the duration at all.
 */
export function findNearestFreeSlot(rawStartMinutes: number, durationMinutes: number, freeBlocks: Range[]): number | null {
  let best: number | null = null;
  let bestDistance = Infinity;
  for (const block of freeBlocks) {
    if (block.endMinutes - block.startMinutes < durationMinutes) continue;
    const maxStart = block.endMinutes - durationMinutes;
    const clamped = Math.max(block.startMinutes, Math.min(snapTo15(rawStartMinutes), maxStart));
    const distance = Math.abs(clamped - rawStartMinutes);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = clamped;
    }
  }
  return best;
}

export type DayGap = Range & { day: string };

/**
 * v5 Stage 12g §B: "A task bigger than the largest free gap... splits
 * automatically into linked parts across gaps and days." Fills
 * `durationMinutes` by walking `gaps` in the order given, skipping any gap
 * too small to be worth its own part unless it's genuinely the task's last
 * sliver (remaining itself is that small) — shared by the drag-time ripple
 * (lib/resolve-drop.ts) and the initial weekly auto-build
 * (lib/auto-placement.ts), so "parts sum to the task's estimate" holds
 * everywhere a task gets split, not just one code path.
 */
export function packAcrossGaps(
  durationMinutes: number,
  gaps: DayGap[],
  minPartMinutes: number
): { parts: DayGap[]; leftoverMinutes: number } {
  const parts: DayGap[] = [];
  let remaining = durationMinutes;
  for (const gap of gaps) {
    if (remaining <= 0) break;
    const available = gap.endMinutes - gap.startMinutes;
    if (available <= 0) continue;
    if (available < minPartMinutes && available < remaining) continue;
    const take = Math.min(available, remaining);
    parts.push({ day: gap.day, startMinutes: gap.startMinutes, endMinutes: gap.startMinutes + take });
    remaining -= take;
  }
  return { parts, leftoverMinutes: Math.max(0, remaining) };
}

export type DropDiagnosis =
  | { ok: true }
  | { ok: false; reason: "no-capacity" | "meeting"; message: string }
  | { ok: false; reason: "block"; message: string; conflictingBlockId: string; conflictingName: string };

/**
 * v5 (drag bug fix): "an invalid drop shows why... instead of silently
 * reverting." Distinguishes the three cases the brief calls out, computed
 * entirely from data the client already has (no round trip needed for the
 * common cases) — `otherBlocks` must already exclude the block being
 * dragged itself.
 */
export function diagnoseDrop(
  range: Range,
  window: Range,
  freeBlocks: Range[],
  otherBlocks: { id: string; name: string; startMinutes: number; endMinutes: number }[]
): DropDiagnosis {
  if (range.endMinutes <= range.startMinutes) {
    return { ok: false, reason: "no-capacity", message: "That slot isn't free" };
  }

  const conflictingBlock = otherBlocks.find((b) => range.startMinutes < b.endMinutes && range.endMinutes > b.startMinutes);
  if (conflictingBlock) {
    return {
      ok: false,
      reason: "block",
      message: `Overlaps ${conflictingBlock.name} at ${formatHHMM(conflictingBlock.startMinutes)}–${formatHHMM(conflictingBlock.endMinutes)}`,
      conflictingBlockId: conflictingBlock.id,
      conflictingName: conflictingBlock.name,
    };
  }

  if (rangeFitsInFreeBlocks(range, freeBlocks)) return { ok: true };

  if (freeBlocks.length === 0) {
    return { ok: false, reason: "no-capacity", message: "That day has no capacity" };
  }

  const blockedBands = complementRanges(window.startMinutes, window.endMinutes, freeBlocks);
  const overlappingBand = blockedBands.find((b) => range.startMinutes < b.endMinutes && range.endMinutes > b.startMinutes);
  if (overlappingBand) {
    return {
      ok: false,
      reason: "meeting",
      message: `Overlaps a meeting at ${formatHHMM(overlappingBand.startMinutes)}–${formatHHMM(overlappingBand.endMinutes)}`,
    };
  }

  return { ok: false, reason: "no-capacity", message: "That slot isn't free" };
}


/**
 * Proposal section 5: touching/overlapping blocks of the same task on the
 * same day combine into one. Returns only the groups where a merge actually
 * happened — the block to keep (extended) and the ones it absorbed.
 */
export function mergeAdjacentBlocks(blocks: BlockRef[]): { keep: BlockRef; absorbed: BlockRef[] }[] {
  const groups = new Map<string, BlockRef[]>();
  for (const block of blocks) {
    const key = `${block.day}:${block.source}:${block.reference}`;
    const list = groups.get(key) ?? [];
    list.push(block);
    groups.set(key, list);
  }

  const results: { keep: BlockRef; absorbed: BlockRef[] }[] = [];
  for (const list of groups.values()) {
    const sorted = [...list].sort((a, b) => a.startMinutes - b.startMinutes);
    let current = sorted[0];
    let absorbed: BlockRef[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const next = sorted[i];
      if (next.startMinutes <= current.endMinutes) {
        current = { ...current, endMinutes: Math.max(current.endMinutes, next.endMinutes) };
        absorbed.push(next);
      } else {
        if (absorbed.length > 0) results.push({ keep: current, absorbed });
        current = next;
        absorbed = [];
      }
    }
    if (absorbed.length > 0) results.push({ keep: current, absorbed });
  }
  return results;
}

/**
 * v5 Stage 12g §B: "Label parts 'Part 2 of 5 · 3.5h'." A task with more
 * than one placed block this week is a split task — this labels each of
 * its own blocks with its chronological position among just that task's
 * blocks (day, then start time), regardless of which other tasks' blocks
 * sit between them on the calendar.
 */
export function labelPartsByTask<T extends { id: string; day: string; startMinutes: number }>(
  blocksForOneTask: T[]
): Map<string, { partIndex: number; partCount: number }> {
  if (blocksForOneTask.length <= 1) return new Map();
  const sorted = [...blocksForOneTask].sort((a, b) => (a.day === b.day ? a.startMinutes - b.startMinutes : a.day.localeCompare(b.day)));
  const labels = new Map<string, { partIndex: number; partCount: number }>();
  sorted.forEach((b, i) => labels.set(b.id, { partIndex: i + 1, partCount: sorted.length }));
  return labels;
}

/**
 * Proposal section 8.5: a task's chronologically last placed block across
 * every block passed in (day, then end time) is "final."
 */
export function computeFinalBlockIds(blocks: BlockRef[]): Set<string> {
  const byTask = new Map<string, BlockRef>();
  for (const block of blocks) {
    const key = `${block.source}:${block.reference}`;
    const current = byTask.get(key);
    const isLater =
      !current || block.day > current.day || (block.day === current.day && block.endMinutes > current.endMinutes);
    if (isLater) byTask.set(key, block);
  }
  return new Set([...byTask.values()].map((b) => b.id));
}
