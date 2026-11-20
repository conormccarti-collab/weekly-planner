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

  const lines = [
    `Today: ${today.dateStr}`,
    `This week (${weekStart} to ${addDaysToDateStr(weekStart, 6)}): ${thisWeekCapacity.toFixed(1)}h capacity available.`,
    `Following week (${followingWeekStart} to ${addDaysToDateStr(followingWeekStart, 6)}): ${followingWeekCapacity.toFixed(1)}h capacity available.`,
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
