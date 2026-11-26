import { orderCandidatesForPlacement, proposeAutoPlacement, type AutoPlaceCandidate, type AvoidSlot, type FreeBlock, type ProposedPlacement } from "@/lib/auto-placement";
import { proposeOverCapacityMoves } from "@/lib/over-capacity";
import { isBlocked } from "@/lib/asana/dependencies";

/**
 * v3 (plan-first): the engine behind "the week is already laid out when the
 * app opens." Pure — no DB access — so it can be unit-tested against a
 * fixture week and reused both for the silent draft-week build/refresh and
 * the accepted-week "things changed" dry-run diff (same function, two call
 * sites, per the plan).
 */
export type BuildCandidate = AutoPlaceCandidate & {
  blockedByGids: string[];
  isSuggested: boolean;
};

export type ExistingRow = {
  key: string; // `${source}:${reference}`
  day: string | null;
  pinned: boolean;
  status: string;
};

/**
 * Pinned, Done/Behind, and past-dated rows are protected from re-planning —
 * brief section 3.5. Protected rows keep their exact placement; everything
 * else is up for re-layout.
 */
export function partitionProtected(rows: ExistingRow[], todayStr: string): { protectedKeys: Set<string>; unprotectedKeys: Set<string> } {
  const protectedKeys = new Set<string>();
  const unprotectedKeys = new Set<string>();
  for (const row of rows) {
    const isPast = row.day != null && row.day < todayStr;
    const isProtected = row.pinned || row.status === "done" || row.status === "behind" || isPast;
    (isProtected ? protectedKeys : unprotectedKeys).add(row.key);
  }
  return { protectedKeys, unprotectedKeys };
}

export type ExistingRowWithHours = ExistingRow & { hours: number | null };

/**
 * v4, "Behind with hours left": the Behind row itself stays protected as
 * history (via `partitionProtected` above, unchanged); this is the task's
 * still-unplaced remainder. Sized to `remaining_hours` minus whatever's
 * already committed elsewhere this week (pinned, or Done — anything that
 * survives a rebuild) — a plain unpinned row doesn't count, since it's
 * about to be deleted and rebuilt by this same pass regardless. Self-
 * stabilizing: once the remainder is placed and pinned (or done), the next
 * rebuild sees it in that subtraction and stops regenerating more. Returns
 * one extra candidate per task that still has hours left, cloned from its
 * normal candidate (same must/priority/stage) so it ranks and places
 * exactly like any other candidate.
 */
export function behindRemainderCandidates(
  candidates: BuildCandidate[],
  existingRows: ExistingRowWithHours[],
  remainingHoursByKey: Map<string, number>
): BuildCandidate[] {
  const candidateByKey = new Map(candidates.map((c) => [keyOf(c), c]));
  const extra: BuildCandidate[] = [];

  for (const [key, remainingHours] of remainingHoursByKey) {
    const hasBehindRowThisWeek = existingRows.some((r) => r.key === key && r.status === "behind");
    if (!hasBehindRowThisWeek) continue;
    // "Already committed" is anything that'll survive this rebuild other
    // than the Behind row itself (which is exactly what `remainingHours`
    // already corrects for) — a pinned block, or a Done one (Done survives
    // regardless of pinned, same as `partitionProtected`'s own rule).
    const alreadyCommittedHours = existingRows
      .filter((r) => r.key === key && r.status !== "behind" && (r.pinned || r.status === "done"))
      .reduce((sum, r) => sum + (r.hours ?? 0), 0);
    const template = candidateByKey.get(key);
    const effectiveRemaining = remainingHours - alreadyCommittedHours;
    if (template && effectiveRemaining > 0) {
      extra.push({ ...template, estimateHours: effectiveRemaining, isSuggested: false });
    }
  }

  return extra;
}

/**
 * A candidate's real placement need, net of hours already committed to it
 * in a *different* week. Without this, a task that's eligible for more
 * than one week's build at once — overdue by the time a later week gets
 * built, or pulled into one directly — has its full estimate re-placed on
 * top of an earlier week's placement it never actually lost: a 28h Edit
 * task due this week and still overdue by the next build ends up with 56h
 * on the calendar instead of 28h. Floors at 0 — fully covered elsewhere
 * means nothing new to place.
 */
export function hoursStillNeeded(estimateHours: number, alreadyPlacedElsewhereHours: number): number {
  return Math.max(0, estimateHours - alreadyPlacedElsewhereHours);
}

export type BuildResult = {
  placements: (ProposedPlacement & { isSuggested: boolean })[];
  movedToNextWeek: { source: "asana" | "personal"; reference: string }[];
  stillUnplaced: { source: "asana" | "personal"; reference: string; reason: string }[];
};

function keyOf(c: { source: string; reference: string }): string {
  return `${c.source}:${c.reference}`;
}

export function buildWeekPlan(
  candidates: BuildCandidate[],
  freeBlocksByDay: Map<string, FreeBlock[]>,
  dayOrder: string[],
  weekCapacityHours: number,
  completedByGid: Map<string, boolean>,
  avoidSlotByKey?: Map<string, AvoidSlot>,
  dayExcludedForCandidate?: (candidate: AutoPlaceCandidate, day: string) => boolean,
  /** v5 Stage 13b: the user's min_split_part_minutes setting — defaults to proposeAutoPlacement's own 60 when not given, same as before this param existed. */
  minPartMinutes?: number
): BuildResult {
  const stillUnplaced: BuildResult["stillUnplaced"] = [];
  const eligible: BuildCandidate[] = [];

  for (const candidate of candidates) {
    if (isBlocked(candidate.blockedByGids, completedByGid)) {
      stillUnplaced.push({ source: candidate.source, reference: candidate.reference, reason: "Waiting on a blocker" });
      continue;
    }
    eligible.push(candidate);
  }

  const ordered = orderCandidatesForPlacement(eligible);

  // Over capacity is decided before placement, not after — lowest-ranked,
  // non-Must candidates are deferred to next week rather than placed and
  // immediately moved back out.
  const overCapacity = proposeOverCapacityMoves(ordered, weekCapacityHours);
  const moveKeys = new Set(overCapacity.toMove.map(keyOf));
  const toPlace = ordered.filter((c) => !moveKeys.has(keyOf(c)));

  const { placements, unplaced } = proposeAutoPlacement(toPlace, freeBlocksByDay, dayOrder, avoidSlotByKey, minPartMinutes, dayExcludedForCandidate);

  const suggestedByKey = new Map(candidates.map((c) => [keyOf(c), c.isSuggested]));
  const finalPlacements = placements.map((p) => ({ ...p, isSuggested: suggestedByKey.get(keyOf(p)) ?? false }));

  for (const u of unplaced) stillUnplaced.push({ source: u.source, reference: u.reference, reason: u.reason });

  return {
    placements: finalPlacements,
    movedToNextWeek: overCapacity.toMove.map((c) => ({ source: c.source, reference: c.reference })),
    stillUnplaced,
  };
}
