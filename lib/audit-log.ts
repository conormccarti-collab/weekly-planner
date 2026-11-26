import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Records a mutation the app made on its own initiative, for the Settings
 * page's "Recent automatic changes" list. Best-effort and never throws —
 * migration 0035 may not be applied yet, and a logging failure must never
 * take down the real mutation it's describing.
 */
export async function logAutoChange(
  supabase: SupabaseClient,
  userId: string,
  summary: string,
  detail?: Record<string, unknown>
): Promise<void> {
  try {
    const { error } = await supabase.from("audit_log").insert({ user_id: userId, summary, detail: detail ?? null });
    if (error) console.error(`logAutoChange: failed to record "${summary}": ${error.message}`);
  } catch (err) {
    console.error(`logAutoChange: failed to record "${summary}": ${err instanceof Error ? err.message : err}`);
  }
}

export type AuditLogEntry = { id: string; summary: string; createdAt: string };

/** Best-effort read for the Settings page — returns [] if migration 0035 isn't applied yet. */
export async function loadRecentAutoChanges(supabase: SupabaseClient, userId: string, limit = 20): Promise<AuditLogEntry[]> {
  const { data } = await supabase
    .from("audit_log")
    .select("id, summary, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data ?? []).map((r) => ({ id: r.id as string, summary: r.summary as string, createdAt: r.created_at as string }));
}
