import type { SupabaseClient } from "@supabase/supabase-js";
import { parseHHMM } from "@/lib/time";
import { detectStage } from "@/lib/asana/stage";
import { loadExistingTaskNames } from "@/lib/chat/context";

const THRESHOLD = 3;
const CONSISTENCY = 0.8;
const SNOOZE_DAYS = 30;

export type MovePatternSuggestion = {
  patternKey: string;
  ruleText: string;
};

function timeOfDay(startMinutes: number): "morning" | "afternoon" {
  return startMinutes < 12 * 60 ? "morning" : "afternoon";
}

/**
 * v5 Stage 18b: "you always move Edit blocks to mornings" — reads the
 * destination of every logged 'moved' event (plan_events, migration 0032),
 * buckets it by the task's stage (detectStage, from the task's name — only
 * Asana tasks have a detectable stage) and whether it landed before/after
 * noon, and surfaces a pattern once a stage has moved the same way at
 * least THRESHOLD times with at least CONSISTENCY agreement.
 *
 * This proposes what it finds even though today's rules engine only
 * enforces avoid_weekday (Stage 13's time-of-day placement preference is
 * deferred) — approving it still creates a real standing rule via
 * addSchedulingRule, just an honestly-labeled "chat-only" one, same as any
 * other freeform rule, until that enforcement lands.
 */
export async function detectMovePatterns(supabase: SupabaseClient, userId: string): Promise<MovePatternSuggestion[]> {
  const [eventsResult, names] = await Promise.all([
    supabase.from("plan_events").select("source, reference, start_time").eq("user_id", userId).eq("event_type", "moved"),
    loadExistingTaskNames(supabase, userId),
  ]);

  const events = eventsResult.data ?? [];
  if (events.length === 0) return [];

  const nameByKey = new Map(names.map((n) => [`${n.source}:${n.reference}`, n.name]));
  const byStage = new Map<string, { morning: number; afternoon: number }>();

  for (const e of events) {
    const name = nameByKey.get(`${e.source as string}:${e.reference as string}`);
    if (!name) continue;
    const stage = detectStage(name);
    if (!stage) continue;
    const bucket = byStage.get(stage) ?? { morning: 0, afternoon: 0 };
    if (timeOfDay(parseHHMM(e.start_time as string)) === "morning") bucket.morning++;
    else bucket.afternoon++;
    byStage.set(stage, bucket);
  }

  const suggestions: MovePatternSuggestion[] = [];
  for (const [stage, { morning, afternoon }] of byStage) {
    const total = morning + afternoon;
    if (total < THRESHOLD) continue;
    const dominant = morning >= afternoon ? "morning" : "afternoon";
    const dominantCount = Math.max(morning, afternoon);
    if (dominantCount / total < CONSISTENCY) continue;
    suggestions.push({
      patternKey: `move_time_of_day:${stage}:${dominant}`,
      ruleText: `Prefer scheduling ${stage} blocks in the ${dominant} — that's where you've moved them to ${dominantCount} of the last ${total} times.`,
    });
  }
  return suggestions;
}

/**
 * Write side — called from the daily cron (app/api/cron/daily-build), not
 * from any page render, so a page load stays read-only (v5 Stage 12c).
 * Inserts newly-detected patterns; a pattern the user already has an open
 * or snoozed suggestion for is left alone (ignoreDuplicates), so rejecting
 * one doesn't get immediately re-added by the very next cron run.
 */
export async function refreshLearnedSuggestions(supabase: SupabaseClient, userId: string): Promise<void> {
  const suggestions = await detectMovePatterns(supabase, userId);
  if (suggestions.length === 0) return;

  await supabase.from("learned_suggestions").upsert(
    suggestions.map((s) => ({ user_id: userId, pattern_key: s.patternKey, rule_text: s.ruleText })),
    { onConflict: "user_id,pattern_key", ignoreDuplicates: true }
  );
}

export type LearnedSuggestion = { id: string; ruleText: string };

/** Read side — a currently-active (not snoozed) suggestion, for the Week page. Best-effort: migration 0032 may not be applied yet. */
export async function loadActiveSuggestions(supabase: SupabaseClient, userId: string): Promise<LearnedSuggestion[]> {
  const nowIso = new Date().toISOString();
  const { data } = await supabase
    .from("learned_suggestions")
    .select("id, rule_text, snoozed_until")
    .eq("user_id", userId);

  return (data ?? [])
    .filter((r) => !r.snoozed_until || (r.snoozed_until as string) < nowIso)
    .map((r) => ({ id: r.id as string, ruleText: r.rule_text as string }));
}

export { SNOOZE_DAYS };
