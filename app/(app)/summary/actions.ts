"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { resolveMorningCheckUpdate, type MorningCheckOutcome } from "@/lib/morning-check";

/**
 * v3 (plan-first) stage 4, brief 7: the same-day version of the morning
 * check, for a block that ended today without being marked Done — one tap,
 * no separate Submit step. Reuses `resolveMorningCheckUpdate` exactly as
 * the morning check does.
 */
export async function submitSameDayCheck(
  blockId: string,
  source: "asana" | "personal",
  reference: string,
  outcome: MorningCheckOutcome,
  plannedHours: number,
  hoursLeft: number | null
) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) throw new Error("Not signed in");

  const update = resolveMorningCheckUpdate(outcome, plannedHours, hoursLeft);
  const { error } = await supabase
    .from("plan_items")
    .update({
      status: update.status,
      actual_hours: update.actualHours,
      ...(update.clearPlacement ? { day: null, start_time: null, end_time: null, hours: null, pinned: false } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", blockId)
    .eq("user_id", user.id);
  if (error) throw new Error(error.message);

  if (update.remainingHours != null) {
    const { error: metaError } = await supabase.from("task_meta").upsert({
      user_id: user.id,
      source,
      reference,
      remaining_hours: update.remainingHours,
      updated_at: new Date().toISOString(),
    });
    if (metaError) throw new Error(metaError.message);
  }

  revalidatePath("/");
}
