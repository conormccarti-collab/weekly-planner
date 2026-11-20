import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_SETTINGS, type Settings } from "./settings";

const SETTINGS_COLUMNS =
  "working_days, hours_per_day, start_times, lunch_times, lunch_minutes, planning_percentage, min_deep_work_block_minutes, timezone, office";

export async function loadSettings(supabase: SupabaseClient, userId: string): Promise<Settings> {
  const { data } = await supabase
    .from("settings")
    .select(SETTINGS_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();

  return data ? (data as Settings) : DEFAULT_SETTINGS;
}
