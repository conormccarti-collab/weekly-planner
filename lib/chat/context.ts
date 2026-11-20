import type { SupabaseClient } from "@supabase/supabase-js";
import { loadSettings } from "@/lib/settings-data";
import { getWeekCapacity } from "@/lib/calendar/week-capacity";
import { addDaysToDateStr, mondayOf, utcInstantToLocal } from "@/lib/time";
import { env } from "@/lib/env";
import type { ExistingTaskName } from "@/lib/chat/match";

/** A plain-text summary of already-computed numbers, for the chat model to quote from — never compute. */
export async function buildChatContext(supabase: SupabaseClient, userId: string): Promise<string> {
  const timezone = env.appTimezone();
  const today = utcInstantToLocal(new Date(), timezone);
  const weekStart = mondayOf(today.dateStr);
  const followingWeekStart = addDaysToDateStr(weekStart, 7);

  const settings = await loadSettings(supabase, userId);
  const [thisWeek, followingWeek, taskRows] = await Promise.all([
    getWeekCapacity(supabase, userId, timezone, settings, weekStart, { useActualStarts: true }),
    getWeekCapacity(supabase, userId, timezone, settings, followingWeekStart, { useActualStarts: false }),
    supabase
      .from("asana_tasks")
      .select("name, due_on, custom_fields, is_plannable, is_container, completed, no_longer_assigned")
      .eq("completed", false)
      .eq("no_longer_assigned", false)
      .eq("is_plannable", true)
      .eq("is_container", false),
  ]);

  const thisWeekCapacity = thisWeek.reduce((s, d) => s + d.plannedCapacityHours, 0);

  const followingWeekCapacity = followingWeek.reduce((s, d) => s + d.plannedCapacityHours, 0);
  const weekEndExclusive = addDaysToDateStr(weekStart, 7);
  const dueThisWeekOrOverdue = (taskRows.data ?? []).filter((t) => t.due_on && t.due_on < weekEndExclusive);

  // v4 Stage 2, brief 5.3: "ask what's at risk" needs real computed facts to
  // quote from, not just the due-date list above — over capacity and
  // needs-estimate counts, the same definitions the week's own summary uses.
  const { data: thisWeekItems } = await supabase
    .from("plan_items")
    .select("hours, status, day")
    .eq("user_id", userId)
    .eq("week_start", weekStart);
  const plannedHours = (thisWeekItems ?? [])
    .filter((r) => r.day != null && r.status !== "suggested")
    .reduce((s, r) => s + Number(r.hours ?? 0), 0);
  const needsEstimateCount = (thisWeekItems ?? []).filter((r) => r.day == null && r.status === "planned").length;
  const atRiskLines: string[] = [];
  if (plannedHours > thisWeekCapacity) {
    atRiskLines.push(`At risk: this week is ${(plannedHours - thisWeekCapacity).toFixed(1)}h over capacity.`);
  }
  if (needsEstimateCount > 0) {
    atRiskLines.push(`At risk: ${needsEstimateCount} task${needsEstimateCount === 1 ? "" : "s"} this week still need${needsEstimateCount === 1 ? "s" : ""} an estimate or couldn't be placed.`);
  }
  if (atRiskLines.length === 0) atRiskLines.push("At risk: nothing flagged right now.");

  const lines = [
    `Today: ${today.dateStr}`,
    `This week (${weekStart} to ${addDaysToDateStr(weekStart, 6)}): ${thisWeekCapacity.toFixed(1)}h capacity available, ${plannedHours.toFixed(1)}h planned.`,
    `Following week (${followingWeekStart} to ${addDaysToDateStr(followingWeekStart, 6)}): ${followingWeekCapacity.toFixed(1)}h capacity available.`,
    ...atRiskLines,
    `Tasks due this week or overdue (${dueThisWeekOrOverdue.length}):`,
    ...dueThisWeekOrOverdue
      .slice(0, 40)
      .map((t) => `  - ${t.name} (due ${t.due_on}, priority: ${t.custom_fields?.["Priority"] ?? "none"})`),
  ];

  return lines.join("\n");
}

export async function loadExistingTaskNames(supabase: SupabaseClient, userId: string): Promise<ExistingTaskName[]> {
  const [asanaResult, personalResult] = await Promise.all([
    supabase
      .from("asana_tasks")
      .select("gid, name")
      .eq("completed", false)
      .eq("no_longer_assigned", false)
      .eq("is_plannable", true)
      .eq("is_container", false),
    supabase.from("personal_tasks").select("id, name").eq("user_id", userId).eq("completed", false),
  ]);

  const asanaNames: ExistingTaskName[] = (asanaResult.data ?? []).map((t) => ({
    source: "asana",
    reference: t.gid,
    name: t.name,
  }));
  const personalNames: ExistingTaskName[] = (personalResult.data ?? []).map((t) => ({
    source: "personal",
    reference: t.id,
    name: t.name,
  }));

  return [...asanaNames, ...personalNames];
}
