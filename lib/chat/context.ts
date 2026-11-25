import type { SupabaseClient } from "@supabase/supabase-js";
import { loadSettings } from "@/lib/settings-data";
import { getWeekCapacity } from "@/lib/calendar/week-capacity";
import { addDaysToDateStr, formatHHMM, mondayOf, parseHHMM, utcInstantToLocal } from "@/lib/time";
import { env } from "@/lib/env";
import type { ExistingTaskName } from "@/lib/chat/match";
import { WEEKDAY_LABELS } from "@/lib/settings";
import { loadReminders } from "@/lib/reminders";

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
  // Also the source for the day-by-day layout below (source/reference/
  // times), so this is one query, not two.
  const { data: thisWeekItems } = await supabase
    .from("plan_items")
    .select("source, reference, hours, status, day, start_time, end_time")
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

  // In-app only, per the user's choice: these facts are here so the model
  // can answer if asked ("anything to follow up on?"), never to prompt it
  // to raise them unprompted.
  const reminders = await loadReminders(supabase, userId, { todayStr: today.dateStr, workingDays: settings.working_days });
  const reminderLines: string[] = [];
  if (reminders.checkoffs.length > 0) {
    reminderLines.push(`Pending Asana checkoffs (${reminders.checkoffs.length}):`);
    reminderLines.push(...reminders.checkoffs.map((c) => `  - ${c.name} — mark complete in Asana too`));
  }
  if (reminders.followUps.length > 0) {
    reminderLines.push(`Subtasks to follow up on (${reminders.followUps.length}):`);
    reminderLines.push(
      ...reminders.followUps.map(
        (f) => `  - ${f.containerName} — ${f.subtaskName}: assigned to ${f.assigneeName ?? "someone else"}, due ${f.dueOn}${f.isOverdue ? " (overdue)" : ""}`
      )
    );
  }

  // Rules window — migration 0027 may not be applied yet, same best-effort
  // read as elsewhere. Advisory only: this just gives the model something
  // to factor into its reply (e.g. flag a conflict); the structured subset
  // of these rules separately, actually steers auto-placement in
  // lib/plan-build-data.ts, not here.
  const { data: rules } = await supabase.from("scheduling_rules").select("text").eq("user_id", userId).eq("active", true);

  // Plain subtraction of two numbers already computed above — the model
  // reads this, it never works it out itself (brief rule 2, "arithmetic is
  // code"). Clamped at 0 since a week already over capacity has no "free".
  const freeHoursThisWeek = Math.max(0, thisWeekCapacity - plannedHours);
  const lockedDays = thisWeek.filter((d) => d.isLocked);

  // Day-by-day layout — without this, the model can see aggregate hours but
  // can't answer anything about a *specific* day (is this placed over
  // lunch, what's on Thursday) without guessing, which it correctly refused
  // to do. Real placements/times only (never "suggested" rows, which aren't
  // committed), one name lookup for everything referenced this week.
  const placedThisWeek = (thisWeekItems ?? []).filter((r) => r.day != null && r.status !== "suggested" && r.start_time && r.end_time);
  const asanaRefs = [...new Set(placedThisWeek.filter((r) => r.source === "asana").map((r) => r.reference as string))];
  const personalRefs = [...new Set(placedThisWeek.filter((r) => r.source === "personal").map((r) => r.reference as string))];
  const [placedAsanaNames, placedPersonalNames] = await Promise.all([
    asanaRefs.length > 0 ? supabase.from("asana_tasks").select("gid, name").in("gid", asanaRefs) : Promise.resolve({ data: [] }),
    personalRefs.length > 0 ? supabase.from("personal_tasks").select("id, name").in("id", personalRefs) : Promise.resolve({ data: [] }),
  ]);
  const nameByKey = new Map<string, string>();
  for (const t of placedAsanaNames.data ?? []) nameByKey.set(`asana:${t.gid}`, t.name as string);
  for (const t of placedPersonalNames.data ?? []) nameByKey.set(`personal:${t.id}`, t.name as string);

  const dayLines: string[] = [];
  for (const day of thisWeek) {
    if (!day.isWorkingDay && !day.isLocked) continue; // a plain weekend - nothing to say
    if (day.isLocked) {
      dayLines.push(`${WEEKDAY_LABELS[day.weekday]} ${day.dateStr}: out of office${day.lockedReason ? ` (${day.lockedReason})` : ""}.`);
      continue;
    }
    const entries = placedThisWeek
      .filter((r) => r.day === day.dateStr && nameByKey.has(`${r.source}:${r.reference}`))
      .sort((a, b) => parseHHMM(a.start_time as string) - parseHHMM(b.start_time as string));
    dayLines.push(`${WEEKDAY_LABELS[day.weekday]} ${day.dateStr} (start ${day.startLabel}, lunch ${day.lunchLabel}):`);
    if (entries.length === 0) {
      dayLines.push(`  - Nothing scheduled.`);
    } else {
      const lunchStartMinutes = parseHHMM(day.lunchLabel);
      const lunchEndMinutes = settings.lunch_enabled ? lunchStartMinutes + settings.lunch_minutes : lunchStartMinutes;
      for (const e of entries) {
        const name = nameByKey.get(`${e.source}:${e.reference}`)!;
        const startMinutes = parseHHMM(e.start_time as string);
        const endMinutes = parseHHMM(e.end_time as string);
        // A real overlap check, not left for the model to eyeball two time
        // ranges itself (brief rule 2, "arithmetic is code").
        const overlapsLunch = settings.lunch_enabled && startMinutes < lunchEndMinutes && endMinutes > lunchStartMinutes;
        dayLines.push(`  - ${name}: ${formatHHMM(startMinutes)}-${formatHHMM(endMinutes)}${overlapsLunch ? " (overlaps lunch)" : ""}`);
      }
    }
  }

  const lines = [
    `Today: ${today.dateStr}`,
    `This week (${weekStart} to ${addDaysToDateStr(weekStart, 6)}): ${thisWeekCapacity.toFixed(1)}h capacity available, ${plannedHours.toFixed(1)}h planned, ${freeHoursThisWeek.toFixed(1)}h free.`,
    `Following week (${followingWeekStart} to ${addDaysToDateStr(followingWeekStart, 6)}): ${followingWeekCapacity.toFixed(1)}h capacity available.`,
    ...atRiskLines,
    `Out of office / locked this week (${lockedDays.length}):`,
    ...lockedDays.map((d) => `  - ${d.dateStr}${d.lockedReason ? ` (${d.lockedReason})` : ""}`),
    `Day-by-day layout this week (start/lunch times and what's actually placed, so you can answer a question about a specific day without guessing):`,
    ...dayLines,
    `Tasks due this week or overdue (${dueThisWeekOrOverdue.length}):`,
    ...dueThisWeekOrOverdue
      .slice(0, 40)
      .map((t) => `  - ${t.name} (due ${t.due_on}, priority: ${t.custom_fields?.["Priority"] ?? "none"})`),
    `Standing rules (${rules?.length ?? 0}):`,
    ...(rules ?? []).map((r) => `  - ${r.text as string}`),
    ...reminderLines,
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
