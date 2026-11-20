import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveEstimate, type EstimateResult } from "@/lib/estimates";
import type { Stage } from "@/lib/asana/stage";

export type EstimateTarget = {
  source: "asana" | "personal";
  reference: string;
  stage: Stage | null;
  videoType: string | null;
};

type TaskMetaEstimateRow = {
  source: string;
  reference: string;
  stage: string | null;
  video_type: string | null;
  estimate_hours: number | null;
  estimate_origin: string | null;
  updated_at: string | null;
};

type DefaultRow = { video_type: string; stage: string; hours: number; variant: string };

/** v2 (18 Nov 2026): Video Type matching is case-insensitive, so "youtube narrative" still matches "Youtube Narrative". */
function sameVideoType(a: string | null, b: string | null): boolean {
  if (a == null || b == null) return false;
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Batch-resolves estimates for many tasks in a handful of queries rather
 * than one round trip per task — fine at this app's scale (tens of tasks).
 */
export async function resolveEstimatesForTasks(
  supabase: SupabaseClient,
  userId: string,
  targets: EstimateTarget[]
): Promise<Map<string, EstimateResult>> {
  const [metaResult, defaultsResult] = await Promise.all([
    supabase
      .from("task_meta")
      .select("source, reference, stage, video_type, estimate_hours, estimate_origin, updated_at")
      .eq("user_id", userId),
    supabase.from("estimate_defaults").select("video_type, stage, hours, variant"),
  ]);

  const metaByKey = new Map<string, TaskMetaEstimateRow>(
    ((metaResult.data ?? []) as TaskMetaEstimateRow[]).map((m) => [`${m.source}:${m.reference}`, m])
  );
  const defaults = (defaultsResult.data ?? []) as DefaultRow[];

  const results = new Map<string, EstimateResult>();

  for (const target of targets) {
    const key = `${target.source}:${target.reference}`;
    const ownMeta = metaByKey.get(key);
    const userHours = ownMeta?.estimate_origin === "user" ? ownMeta.estimate_hours : null;
    // v4 Stage 2, tier 4: a model suggestion already generated and cached
    // for this exact task (see `gatherWeekBuildInputs`, the only writer of
    // `estimate_origin: "suggested"`) — read it back here rather than
    // calling the model again on every load.
    const suggestedHours = ownMeta?.estimate_origin === "suggested" ? ownMeta.estimate_hours : null;

    let learnedHours: number | null = null;
    if (target.stage && target.videoType) {
      const candidates = [...metaByKey.values()]
        .filter(
          (m) =>
            m.estimate_origin === "user" &&
            m.stage === target.stage &&
            sameVideoType(m.video_type, target.videoType) &&
            `${m.source}:${m.reference}` !== key &&
            m.estimate_hours != null
        )
        .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""));
      learnedHours = candidates[0]?.estimate_hours ?? null;
    }

    let defaultHours: number | null = null;
    let ambiguousDefaults: { variant: string; hours: number }[] | undefined;
    if (target.stage) {
      const matches = defaults.filter(
        (d) => d.stage === target.stage && (sameVideoType(d.video_type, target.videoType) || d.video_type === "Any")
      );
      if (matches.length === 1) {
        defaultHours = matches[0].hours;
      } else if (matches.length > 1) {
        // v2 (18 Nov 2026): more than one row matches (e.g. producing vs.
        // overseeing) — offer both as one-tap picks instead of silently
        // falling through to "needs estimate".
        ambiguousDefaults = matches.map((m) => ({ variant: m.variant, hours: m.hours }));
      }
    }

    results.set(key, resolveEstimate({ userHours, learnedHours, defaultHours, suggestedHours, ambiguousDefaults }));
  }

  return results;
}

export type EstimateDefaultRow = { video_type: string; stage: string; variant: string; hours: number; focus_type: string };

/** v4 Stage 1: lists every row for Settings' editable-defaults table. */
export async function loadAllEstimateDefaults(supabase: SupabaseClient): Promise<EstimateDefaultRow[]> {
  const { data } = await supabase
    .from("estimate_defaults")
    .select("video_type, stage, variant, hours, focus_type")
    .order("video_type")
    .order("stage")
    .order("variant");
  return (data ?? []) as EstimateDefaultRow[];
}
