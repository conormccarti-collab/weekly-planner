import type { SupabaseClient, User } from "@supabase/supabase-js";
import { detectStage } from "@/lib/asana/stage";
import { computeEstimateReport, type EstimateReportRow, type ReportInputRow } from "@/lib/estimate-report";

export type Period = "month" | "quarter" | "all";

export function periodStart(period: Period, todayStr: string): string | null {
  if (period === "all") return null;
  const [year, month] = todayStr.split("-").map(Number);
  if (period === "month") return `${year}-${String(month).padStart(2, "0")}-01`;
  const quarterStartMonth = Math.floor((month - 1) / 3) * 3 + 1;
  return `${year}-${String(quarterStartMonth).padStart(2, "0")}-01`;
}

/** Shared between the Reports page and its CSV export route, so they can never drift apart. */
export async function loadEstimateReport(supabase: SupabaseClient, user: User, period: Period, todayStr: string): Promise<EstimateReportRow[]> {
  const start = periodStart(period, todayStr);

  let query = supabase
    .from("plan_items")
    .select("reference, hours, actual_hours, status")
    .eq("user_id", user.id)
    .eq("source", "asana")
    .not("day", "is", null)
    .not("hours", "is", null);
  if (start) query = query.gte("day", start);
  const { data: itemRows } = await query;

  const refs = [...new Set((itemRows ?? []).map((r) => r.reference as string))];
  const { data: taskRows } =
    refs.length > 0 ? await supabase.from("asana_tasks").select("gid, name, custom_fields").in("gid", refs) : { data: [] };
  const taskByGid = new Map((taskRows ?? []).map((t) => [t.gid as string, t]));

  const inputRows: ReportInputRow[] = (itemRows ?? []).map((r) => {
    const task = taskByGid.get(r.reference as string);
    return {
      videoType: (task?.custom_fields as Record<string, string | null> | undefined)?.["Video Type"]?.trim() ?? null,
      stage: task ? detectStage(task.name as string) : null,
      hours: Number(r.hours ?? 0),
      actualHours: r.actual_hours != null ? Number(r.actual_hours) : null,
      status: r.status as string,
    };
  });

  return computeEstimateReport(inputRows);
}
