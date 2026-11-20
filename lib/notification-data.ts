import type { SupabaseClient, User } from "@supabase/supabase-js";
import { loadWeekViewData } from "@/lib/week-view-data";
import { computeMorningCheckFor } from "@/app/(app)/morning-check/actions";
import { addWorkingDays } from "@/lib/time";
import type { NotificationContent } from "@/lib/notification-content";

/**
 * Brief section 10: "the morning check still outstanding, deadline risks
 * (from Stage 4 plus tasks due within two working days that are not
 * placed), and any Hygiene flags on this week's deliverables." Reuses the
 * same data `loadWeekViewData` already assembles — no separate queries for
 * back-scheduling or Hygiene.
 */
export async function gatherNotificationContent(supabase: SupabaseClient, user: User): Promise<NotificationContent> {
  const [morningCheck, data] = await Promise.all([computeMorningCheckFor(supabase, user.id), loadWeekViewData(supabase, user)]);

  const morningCheckOutstanding = morningCheck.items.map((i) => `${i.name} (${i.day}, ${i.plannedHours}h planned)`);

  const deadlineRisks: string[] = data.startsThisWeek.map(
    (s) => `${s.deliverableName} — ${s.stage}: start by ${s.latestStartDate}${s.isPastDue ? " (already passed)" : ""}`
  );
  const deadlineCutoff = addWorkingDays(data.todayStr, 2, data.workingDays);
  for (const task of data.thisWeekTasks) {
    if (task.placements.length === 0 && task.dueOn != null && task.dueOn <= deadlineCutoff) {
      deadlineRisks.push(`${task.name} is due ${task.dueOn} and isn't placed`);
    }
  }

  return { morningCheckOutstanding, deadlineRisks, hygieneIssues: data.weekHygieneIssues };
}
