"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { parseSchedulingRule } from "@/lib/chat/claude";

async function requireUser(supabase: SupabaseClient): Promise<User> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  return data.user;
}

export type SchedulingRule = {
  id: string;
  text: string;
  parsedKind: "freeform" | "avoid_weekday";
  parsedWeekday: string | null;
  parsedStage: string | null;
};

export async function listSchedulingRules(): Promise<SchedulingRule[]> {
  const supabase = await createClient();
  const user = await requireUser(supabase);
  const { data } = await supabase
    .from("scheduling_rules")
    .select("id, text, parsed_kind, parsed_weekday, parsed_stage")
    .eq("user_id", user.id)
    .eq("active", true)
    .order("created_at", { ascending: true });
  return (data ?? []).map((r) => ({
    id: r.id as string,
    text: r.text as string,
    parsedKind: r.parsed_kind as "freeform" | "avoid_weekday",
    parsedWeekday: r.parsed_weekday as string | null,
    parsedStage: r.parsed_stage as string | null,
  }));
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
