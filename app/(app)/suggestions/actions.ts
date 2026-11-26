"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { addSchedulingRule } from "@/app/(app)/settings/rules-actions";
import { SNOOZE_DAYS } from "@/lib/plan-pattern-learning";
import { addDaysToDateStr, utcInstantToLocal } from "@/lib/time";
import { env } from "@/lib/env";

async function requireUser(supabase: SupabaseClient): Promise<User> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  return data.user;
}

/** v5 Stage 18c: approving a learned suggestion creates a real standing rule — same path as typing it into Settings by hand. */
export async function approveSuggestion(id: string, ruleText: string): Promise<void> {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  await addSchedulingRule(ruleText);
  await supabase.from("learned_suggestions").delete().eq("id", id).eq("user_id", user.id);

  revalidatePath("/");
}

/** Rejecting self-silences this exact pattern for 30 days rather than deleting it — a pattern that keeps recurring should resurface. */
export async function rejectSuggestion(id: string): Promise<void> {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const todayStr = utcInstantToLocal(new Date(), env.appTimezone()).dateStr;
  const snoozedUntil = `${addDaysToDateStr(todayStr, SNOOZE_DAYS)}T00:00:00.000Z`;
  await supabase.from("learned_suggestions").update({ snoozed_until: snoozedUntil }).eq("id", id).eq("user_id", user.id);

  revalidatePath("/");
}
