export type EstimateOrigin = "user" | "learned" | "default" | "suggested" | "none";

export type AmbiguousDefault = { variant: string; hours: number };

export type EstimateResult = {
  hours: number | null;
  origin: EstimateOrigin;
  label: string;
  /** v2 (18 Nov 2026): more than one default row matched (e.g. producing vs. overseeing) — offer both as one-tap picks instead of silently falling to "needs estimate". */
  ambiguousOptions?: AmbiguousDefault[];
};

export type EstimateCandidates = {
  /** Tier 1: the user's own figure for this exact task. */
  userHours: number | null;
  /** Tier 2: a figure the user previously gave a task of the same type. */
  learnedHours: number | null;
  /** Tier 3: estimate_defaults for this content type + stage. */
  defaultHours: number | null;
  /** Tier 4: a model suggestion — not counted in totals until confirmed. */
  suggestedHours: number | null;
  /** Set only when more than one default row matched and none could be auto-picked. */
  ambiguousDefaults?: AmbiguousDefault[];
};

/** Brief section 6's five-tier precedence, in order. */
export function resolveEstimate(candidates: EstimateCandidates): EstimateResult {
  if (candidates.userHours != null) {
    return { hours: candidates.userHours, origin: "user", label: "your estimate" };
  }
  if (candidates.learnedHours != null) {
    return { hours: candidates.learnedHours, origin: "learned", label: "from your earlier entry" };
  }
  if (candidates.defaultHours != null) {
    return { hours: candidates.defaultHours, origin: "default", label: "default" };
  }
  if (candidates.suggestedHours != null) {
    return { hours: candidates.suggestedHours, origin: "suggested", label: "suggested" };
  }
  if (candidates.ambiguousDefaults && candidates.ambiguousDefaults.length > 0) {
    return { hours: null, origin: "none", label: "needs estimate", ambiguousOptions: candidates.ambiguousDefaults };
  }
  return { hours: null, origin: "none", label: "needs estimate" };
}

/** Brief section 6: a suggested-but-unconfirmed estimate is excluded from totals. */
export function isCountedInTotals(origin: EstimateOrigin): boolean {
  return origin === "user" || origin === "learned" || origin === "default";
}

export type PlacementEstimate = { hours: number; isSuggested: boolean };

/**
 * v4 Stage 2, brief section 5.1: a task with no user/learned/default figure
 * gets a real model suggestion (tier 4) instead of the old synthetic 1h
 * placeholder. It's still placed — hatched, excluded from totals, one tap
 * from confirmed — but only when a real hours figure exists from *some*
 * tier. "If the model is unavailable, list the task as needs estimate and
 * do not place it" — so `estimate.hours == null` (tier 5, nothing resolved)
 * returns null here rather than inventing a number.
 */
export function placementHours(estimate: EstimateResult): PlacementEstimate | null {
  if (estimate.hours == null) return null;
  return { hours: estimate.hours, isSuggested: estimate.origin === "suggested" };
}
