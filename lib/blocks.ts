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

export type SplitResult = {
  before: Range | null;
  inserted: Range;
  after: Range | null;
};

/**
 * Proposal section 4: dropping task B onto the middle of A's block splits A
 * into a before/after pair and inserts B between them, capped to whatever
 * room A's block has at the drop point.
 */
export function splitBlockAt(existing: Range, insertStartRaw: number, desiredDurationMinutes: number): SplitResult {
  const insertStart = Math.max(existing.startMinutes, Math.min(snapTo15(insertStartRaw), existing.endMinutes));
  const availableAfterInsertStart = existing.endMinutes - insertStart;
  const duration = Math.max(0, Math.min(snapTo15(desiredDurationMinutes), availableAfterInsertStart));
  const insertedEnd = insertStart + duration;

  return {
    before:
      insertStart > existing.startMinutes
        ? { startMinutes: existing.startMinutes, endMinutes: insertStart }
        : null,
    inserted: { startMinutes: insertStart, endMinutes: insertedEnd },
    after: insertedEnd < existing.endMinutes ? { startMinutes: insertedEnd, endMinutes: existing.endMinutes } : null,
  };
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
