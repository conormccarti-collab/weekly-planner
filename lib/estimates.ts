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

export type ProvisionalEstimate = { hours: number; isProvisional: boolean };

/**
 * v3 (plan-first): a task with no real estimate used to be skipped entirely,
 * leaving the week empty. Instead it gets a provisional 1h placeholder, so it
 * still gets placed — unless there are ambiguous options to pick from, which
 * already has its own one-tap resolution path and shouldn't be papered over.
 */
export function provisionalHours(estimate: EstimateResult): ProvisionalEstimate | null {
  if (estimate.hours != null) return { hours: estimate.hours, isProvisional: false };
  if (estimate.ambiguousOptions && estimate.ambiguousOptions.length > 0) return null;
  return { hours: 1, isProvisional: true };
}
