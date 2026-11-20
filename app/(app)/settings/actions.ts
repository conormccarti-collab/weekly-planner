"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { OFFICES } from "@/lib/brand-colors";

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export async function saveSettings(formData: FormData) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) {
    throw new Error("Not signed in");
  }

  const workingDays = WEEKDAYS.filter((day) => formData.get(`working_day_${day}`) === "on");

  const startTimes: Record<string, string> = {};
  const lunchTimes: Record<string, string> = {};
  for (const day of workingDays) {
    const startValue = formData.get(`start_time_${day}`);
    if (typeof startValue === "string" && startValue) {
      startTimes[day] = startValue;
    }
    const lunchValue = formData.get(`lunch_time_${day}`);
    if (typeof lunchValue === "string" && lunchValue) {
      lunchTimes[day] = lunchValue;
    }
  }

  const hoursPerDay = Number(formData.get("hours_per_day"));
  const lunchMinutes = Number(formData.get("lunch_minutes"));
  const planningPercentage = Number(formData.get("planning_percentage"));
  const minDeepWorkBlockMinutes = Number(formData.get("min_deep_work_block_minutes"));
  const timezone = String(formData.get("timezone"));
  const officeRaw = formData.get("office");
  const office = typeof officeRaw === "string" && OFFICES.includes(officeRaw as (typeof OFFICES)[number]) ? officeRaw : null;
  const notificationsEnabled = formData.get("notifications_enabled") === "on";

  if (
    !Number.isFinite(hoursPerDay) ||
    !Number.isFinite(lunchMinutes) ||
    !Number.isFinite(planningPercentage) ||
    !Number.isFinite(minDeepWorkBlockMinutes) ||
    !timezone
  ) {
    throw new Error("Invalid settings values");
  }

  const { error } = await supabase.from("settings").upsert({
    user_id: user.id,
    working_days: workingDays,
    hours_per_day: hoursPerDay,
    start_times: startTimes,
    lunch_times: lunchTimes,
    lunch_minutes: lunchMinutes,
    planning_percentage: planningPercentage,
    min_deep_work_block_minutes: minDeepWorkBlockMinutes,
    timezone,
    office,
    notifications_enabled: notificationsEnabled,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    throw new Error(error.message);
  }

  // The Office picker sets the accent colour applied in the (app) layout —
  // revalidate the whole app shell, not just this page.
  revalidatePath("/", "layout");
}

/**
 * v4 Stage 1: estimate defaults are global config (no `user_id` on the
 * table), so the signed-in user's own RLS session can't update it — only
 * the existing "authenticated read" policy applies. The write itself goes
 * through the service-role client (already used for OAuth-token storage
 * elsewhere), after confirming a real session exists, same as every other
 * action here. `estimate_history` logging stays on the normal client since
 * that table is owner-scoped RLS.
 */
export async function updateEstimateDefault(videoType: string, stage: string, variant: string, hours: number) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) {
    throw new Error("Not signed in");
  }
  if (!Number.isFinite(hours) || hours < 0) {
    throw new Error("Hours must be a non-negative number");
  }

  const { data: existing } = await supabase
    .from("estimate_defaults")
    .select("hours")
    .eq("video_type", videoType)
    .eq("stage", stage)
    .eq("variant", variant)
    .maybeSingle();

  const { error: updateError } = await createServiceRoleClient()
    .from("estimate_defaults")
    .update({ hours })
    .eq("video_type", videoType)
    .eq("stage", stage)
    .eq("variant", variant);
  if (updateError) {
    throw new Error(updateError.message);
  }

  const { error: historyError } = await supabase.from("estimate_history").insert({
    user_id: user.id,
    source: "default",
    reference: `${videoType}:${stage}:${variant}`,
    task_type_key: `${videoType}:${stage}`,
    old_hours: existing?.hours ?? null,
    new_hours: hours,
  });
  if (historyError) {
    throw new Error(historyError.message);
  }

  revalidatePath("/", "layout");
}
