import { orderCandidatesForPlacement, proposeAutoPlacement, type AutoPlaceCandidate, type FreeBlock, type ProposedPlacement } from "@/lib/auto-placement";
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
  completedByGid: Map<string, boolean>
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

  const { placements, unplaced } = proposeAutoPlacement(toPlace, freeBlocksByDay, dayOrder);

  const suggestedByKey = new Map(candidates.map((c) => [keyOf(c), c.isSuggested]));
  const finalPlacements = placements.map((p) => ({ ...p, isSuggested: suggestedByKey.get(keyOf(p)) ?? false }));

  for (const u of unplaced) stillUnplaced.push({ source: u.source, reference: u.reference, reason: u.reason });

  return {
    placements: finalPlacements,
    movedToNextWeek: overCapacity.toMove.map((c) => ({ source: c.source, reference: c.reference })),
    stillUnplaced,
  };
}
