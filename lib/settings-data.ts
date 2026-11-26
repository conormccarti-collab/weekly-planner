import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_SETTINGS, type Settings } from "./settings";

const SETTINGS_COLUMNS =
  "working_days, hours_per_day, start_times, lunch_times, lunch_minutes, planning_percentage, min_deep_work_block_minutes, timezone, office, notifications_enabled, planned_project_gids";

// v5 Stage 12g §C: a separate best-effort fetch, same as plan_events
// (migration 0024) elsewhere — migration 0025 may not be applied yet, and a
// failed query here (unlike the main one above) must not take the rest of
// settings down with it.
const BREAK_SETTINGS_COLUMNS = "lunch_enabled, lunch_mode, lunch_window_start, lunch_window_end, min_split_part_minutes";

// v5 Stage 13a: another separate best-effort fetch, same reason as
// BREAK_SETTINGS_COLUMNS above — migration 0031 may not be applied yet.
const BUFFER_SETTINGS_COLUMNS = "buffer_percentage";

export async function loadSettings(supabase: SupabaseClient, userId: string): Promise<Settings> {
  const { data } = await supabase
    .from("settings")
    .select(SETTINGS_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();

  if (!data) return DEFAULT_SETTINGS;

  const [{ data: breakSettings }, { data: bufferSettings }] = await Promise.all([
    supabase.from("settings").select(BREAK_SETTINGS_COLUMNS).eq("user_id", userId).maybeSingle(),
    supabase.from("settings").select(BUFFER_SETTINGS_COLUMNS).eq("user_id", userId).maybeSingle(),
  ]);

  return {
    ...DEFAULT_SETTINGS,
    ...(data as Settings),
    ...(breakSettings as Partial<Settings> | null),
    ...(bufferSettings as Partial<Settings> | null),
  };
}
