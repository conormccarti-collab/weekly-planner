import type { SupabaseClient } from "@supabase/supabase-js";
import { periodStart, type Period } from "@/lib/estimate-report-data";

export const PERIOD_LABELS: Record<Period, string> = { month: "this month", quarter: "this quarter", all: "all time" };

/**
 * v5 Stage 14b: "ask over history" ('how many hours have I spent on X?') —
 * arithmetic is code, the model only phrases the number this returns, never
 * computes it. `reference` narrows to one task/subtask (already resolved
 * upstream, same findCandidateMatches path every other chat tool uses);
 * null sums every Done block in the period, for "what did I get done?".
 */
export async function sumActualHours(
  supabase: SupabaseClient,
  userId: string,
  period: Period,
  todayStr: string,
  reference?: { source: "asana" | "personal"; reference: string }
): Promise<{ hours: number; blockCount: number }> {
  const start = periodStart(period, todayStr);

  // "done" has actual_hours defaulted to the planned figure; "behind" has a
  // real partial actual_hours from the hours-left answer — both represent
  // genuine time spent, unlike "planned"/"moved"/"suggested".
  let query = supabase.from("plan_items").select("hours, actual_hours").eq("user_id", userId).in("status", ["done", "behind"]);
  if (start) query = query.gte("day", start);
  if (reference) query = query.eq("source", reference.source).eq("reference", reference.reference);
  const { data } = await query;

  const rows = data ?? [];
  const hours = rows.reduce((sum, r) => sum + Number(r.actual_hours ?? r.hours ?? 0), 0);
  return { hours, blockCount: rows.length };
}
