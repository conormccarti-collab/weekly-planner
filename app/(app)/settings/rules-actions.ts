"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { parseSchedulingRule } from "@/lib/chat/claude";
import { loadSettings } from "@/lib/settings-data";
import { findRuleConflicts, countBlocksOnExcludedDay, type ActiveWeekdayRule } from "@/lib/scheduling-rules";
import { mondayOf, utcInstantToLocal, type Weekday } from "@/lib/time";
import { env } from "@/lib/env";

async function requireUser(supabase: SupabaseClient): Promise<User> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  return data.user;
}

export type SchedulingRule = {
  id: string;
  text: string;
  active: boolean;
  parsedKind: "freeform" | "avoid_weekday";
  parsedWeekday: string | null;
  parsedStage: string | null;
  /** v5 Stage 14a: set only for an active avoid_weekday rule. */
  conflict: string | null;
  blocksOnExcludedDay: number | null;
};

/**
 * Lists every rule, active or not — active-only filtering stays in
 * lib/chat/context.ts (what the model actually sees) and
 * lib/plan-build-data.ts (what's actually enforced); this list is for the
 * Settings toggle, which needs to show an off rule too, not hide it.
 */
export async function listSchedulingRules(): Promise<SchedulingRule[]> {
  const supabase = await createClient();
  const user = await requireUser(supabase);
  const { data } = await supabase
    .from("scheduling_rules")
    .select("id, text, active, parsed_kind, parsed_weekday, parsed_stage")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  const rows = data ?? [];

  const settings = await loadSettings(supabase, user.id);
  const todayStr = utcInstantToLocal(new Date(), env.appTimezone()).dateStr;
  const weekStart = mondayOf(todayStr);
  const { data: placedRows } = await supabase.from("plan_items").select("day").eq("user_id", user.id).eq("week_start", weekStart).not("day", "is", null);
  const placedDays = (placedRows ?? []).map((r) => r.day as string);

  const activeWeekdayRules: ActiveWeekdayRule[] = rows
    .filter((r) => r.active && r.parsed_kind === "avoid_weekday" && r.parsed_weekday)
    .map((r) => ({ id: r.id as string, weekday: r.parsed_weekday as Weekday, stage: r.parsed_stage as string | null }));
  const conflicts = findRuleConflicts(activeWeekdayRules, settings.working_days);

  return rows.map((r) => {
    const isActiveWeekdayRule = r.active && r.parsed_kind === "avoid_weekday" && r.parsed_weekday;
    return {
      id: r.id as string,
      text: r.text as string,
      active: r.active as boolean,
      parsedKind: r.parsed_kind as "freeform" | "avoid_weekday",
      parsedWeekday: r.parsed_weekday as string | null,
      parsedStage: r.parsed_stage as string | null,
      conflict: isActiveWeekdayRule ? (conflicts.get(r.id as string) ?? null) : null,
      blocksOnExcludedDay: isActiveWeekdayRule
        ? countBlocksOnExcludedDay({ id: r.id as string, weekday: r.parsed_weekday as Weekday, stage: r.parsed_stage as string | null }, placedDays)
        : null,
    };
  });
}

/** v5 Stage 14a: the on/off switch — the `active` column already existed (migration 0027), only the toggle endpoint was missing. */
export async function setSchedulingRuleActive(id: string, active: boolean): Promise<void> {
  const supabase = await createClient();
  const user = await requireUser(supabase);
  const { error } = await supabase.from("scheduling_rules").update({ active }).eq("user_id", user.id).eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/settings");
  revalidatePath("/");
}

/**
 * Parsed once here, at creation time — never re-parsed on every build. A
 * rule the model can't turn into a structured shape is stored as 'freeform'
 * (chat-context only) rather than guessed at; see parseSchedulingRule's own
 * "safe default on failure" doc.
 */
export async function addSchedulingRule(text: string): Promise<void> {
  const supabase = await createClient();
  const user = await requireUser(supabase);
  const trimmed = text.trim();
  if (!trimmed) throw new Error("A rule needs some text.");

  const parsed = await parseSchedulingRule(trimmed);
  const { error } = await supabase.from("scheduling_rules").insert({
    user_id: user.id,
    text: trimmed,
    parsed_kind: parsed.kind,
    parsed_weekday: parsed.kind === "avoid_weekday" ? parsed.weekday : null,
    parsed_stage: parsed.kind === "avoid_weekday" ? parsed.stage : null,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/settings");
  revalidatePath("/");
}

export async function removeSchedulingRule(id: string): Promise<void> {
  const supabase = await createClient();
  const user = await requireUser(supabase);
  const { error } = await supabase.from("scheduling_rules").delete().eq("user_id", user.id).eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/settings");
  revalidatePath("/");
}
