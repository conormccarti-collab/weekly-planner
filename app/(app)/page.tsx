import { createClient } from "@/lib/supabase/server";
import { SyncBar } from "@/components/sync-bar";
import { Dashboard } from "@/components/dashboard";
import { MorningCheckPanel } from "@/components/morning-check-panel";
import { WeekList } from "@/components/week/week-list";
import { BottomChatBar } from "@/components/week/bottom-chat-bar";
import { EverythingElseList } from "@/components/everything-else-list";
import { loadWeekViewData } from "@/lib/week-view-data";
import { computeMorningCheck } from "@/app/(app)/morning-check/actions";
import { buildWeekSummaryFacts, formatDailySummaryText } from "@/lib/summary";
import { SameDayCheckList } from "@/components/same-day-check";
import { SummaryAutoRefresh } from "@/components/summary-auto-refresh";
import { StartsThisWeekList } from "@/components/starts-this-week";
import { RemindersList } from "@/components/reminders-list";
import { loadChatHistory } from "@/app/(app)/chat/actions";
import { loadReminders } from "@/lib/reminders";
import { utcInstantToLocal } from "@/lib/time";
import { env } from "@/lib/env";

export default async function WeekPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;

  if (!user) {
    return <h1 className="text-lg font-semibold">Week</h1>;
  }

  // v5 Stage 12c: "the page load must be read-only." The week is kept built
  // ahead of time by other triggers instead — a sync completing, a user
  // action (chat, Regenerate), and the daily cron — never by viewing it.
  const nowLocal = utcInstantToLocal(new Date(), env.appTimezone());

  const data = await loadWeekViewData(supabase, user);
  // v3 (plan-first) stage 6, brief 9.3: the morning check runs on every
  // open instead of behind a button — same pattern as refreshDraftWeek.
  const morningCheck = await computeMorningCheck();
  const reminders = await loadReminders(supabase, user.id, {
    todayStr: data.todayStr,
    workingDays: data.workingDays,
    plannedProjectGids: data.plannedProjectGids,
  });

  // The old WeekSummary card's facts, now shown as the first chat message of
  // the day instead of a standalone box, per the user's preference — same
  // source of truth (lib/summary.ts), just a different presentation.
  const facts = buildWeekSummaryFacts(data, data.workingDays, nowLocal.minutesFromMidnight);
  const chatHistory = await loadChatHistory(formatDailySummaryText(facts));

  return (
    <div className="flex items-start gap-4">
      <div className="min-w-0 flex-1">
        <h1 className="text-lg font-semibold">Week</h1>
        <div className="mt-6">
          <SyncBar asana={data.asanaStatus} calendar={data.calendarStatus} />
          <SummaryAutoRefresh />
          {facts.endedNotDone.length > 0 && <SameDayCheckList blocks={facts.endedNotDone} />}
          <StartsThisWeekList items={data.startsThisWeek} />
          <RemindersList data={reminders} />
          <Dashboard
            weekCapacityHours={data.weekCapacityHours}
            weekPlannedHours={data.weekPlannedHours}
            weekSuggestedHours={data.weekSuggestedHours}
            breakdown={data.breakdown}
          />
          <MorningCheckPanel initial={morningCheck} />
          <WeekList
            weekStart={data.weekStart}
            followingWeekStart={data.followingWeekStart}
            todayStr={data.todayStr}
            days={data.capacityDays}
            followingDays={data.followingCapacityDays}
            thisWeekTasks={data.thisWeekTasks}
            shoots={data.shoots}
            rejectedKeys={data.rejectedKeys}
            weekCapacityHours={data.weekCapacityHours}
            weekPlannedHours={data.weekPlannedHours}
            weekCompletedHours={data.weekCompletedHours}
            checkoffs={reminders.checkoffs}
          />
          <EverythingElseList weekStart={data.weekStart} groups={data.everythingElseGroups} parkedGids={data.parkedKeys} />
        </div>
      </div>
      <BottomChatBar initialHistory={chatHistory} />
    </div>
  );
}
