import { orderCandidatesForPlacement, type AutoPlaceCandidate } from "@/lib/auto-placement";

export type OverCapacityResult = {
  overCapacityHours: number;
  toMove: AutoPlaceCandidate[];
};

/**
 * Release 1.1, brief section 10: "Over capacity. Propose which tasks move
 * to next week, lowest-ranked first, never a Must." Reuses the same
 * ordering as automatic placement (brief section 10's ranking) and walks
 * it from the bottom — the lowest-ranked, non-Must tasks are proposed to
 * move first, until the week is back within capacity (or every eligible
 * task has been proposed, if that's still not enough).
 */
export function proposeOverCapacityMoves(candidates: AutoPlaceCandidate[], weekCapacityHours: number): OverCapacityResult {
  const totalHours = candidates.reduce((sum, c) => sum + c.estimateHours, 0);
  const overCapacityHours = Math.max(0, totalHours - weekCapacityHours);
  if (overCapacityHours <= 0) {
    return { overCapacityHours: 0, toMove: [] };
  }

  const ordered = orderCandidatesForPlacement(candidates);
  const movable = ordered.filter((c) => !c.must).reverse(); // lowest-ranked first

  const toMove: AutoPlaceCandidate[] = [];
  let hoursToClear = overCapacityHours;
  for (const candidate of movable) {
    if (hoursToClear <= 0) break;
    toMove.push(candidate);
    hoursToClear -= candidate.estimateHours;
  }

  return { overCapacityHours, toMove };
}
