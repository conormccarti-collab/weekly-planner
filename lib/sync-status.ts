import type { SupabaseClient } from "@supabase/supabase-js";
import type { SyncSourceStatus } from "@/components/sync-bar";

/**
 * v4 Stage 1 checklist, brief section 5: "Show 'last synced' on every
 * screen that shows Asana data" — previously only the Week screen had
 * this (via `loadWeekViewData`'s own sync_log reads). Shared here so
 * Projects/Ideas/Hygiene can show the same `<SyncBar>`.
 */
export async function loadSyncStatuses(supabase: SupabaseClient): Promise<{ asana: SyncSourceStatus; calendar: SyncSourceStatus }> {
  const [asanaResult, calendarResult] = await Promise.all([
    supabase.from("sync_log").select("finished_at, ok, error").eq("source", "asana").order("finished_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
    supabase.from("sync_log").select("finished_at, ok, error").eq("source", "calendar").order("finished_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
  ]);

  return {
    asana: {
      lastSyncedAt: asanaResult.data?.finished_at ?? null,
      lastSyncError: asanaResult.data?.ok === false ? asanaResult.data.error : null,
    },
    calendar: {
      lastSyncedAt: calendarResult.data?.finished_at ?? null,
      lastSyncError: calendarResult.data?.ok === false ? calendarResult.data.error : null,
      needsReconnect: calendarResult.data?.error === "RECONNECT_REQUIRED",
    },
  };
}
