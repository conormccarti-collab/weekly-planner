export type BlockerTask = { gid: string; name: string; completed: boolean };

/** v2 (18 Nov 2026), item B.8: "blocked_by_gids" is read but drives a warning only — placement is never blocked. */
export function unfinishedBlockers(blockers: BlockerTask[]): BlockerTask[] {
  return blockers.filter((b) => !b.completed);
}

export function blockerWarning(blockers: BlockerTask[]): string | undefined {
  const unfinished = unfinishedBlockers(blockers);
  if (unfinished.length === 0) return undefined;
  const names = unfinished.map((b) => b.name).join(", ");
  return `Still waiting on: ${names}`;
}

/**
 * v3 (plan-first): "never place a task before a task that blocks it" —
 * blocked_by_gids now gates auto-build eligibility, not just a warning.
 * A blocker gid with no entry in `completedByGid` (e.g. it's missing from
 * the fetched set entirely) is treated as still-blocking, the conservative
 * default.
 */
export function isBlocked(blockedByGids: string[], completedByGid: Map<string, boolean>): boolean {
  return blockedByGids.some((gid) => !completedByGid.get(gid));
}
