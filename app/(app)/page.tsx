import { createClient } from "@/lib/supabase/server";
import { SyncBar } from "@/components/sync-bar";
import { Dashboard } from "@/components/dashboard";
import { MorningCheckPanel } from "@/components/morning-check-panel";
import { PlanBoard } from "@/components/plan-board";
import { EverythingElseList } from "@/components/everything-else-list";
import { loadWeekViewData } from "@/lib/week-view-data";
import { computeWeekChanges } from "@/app/(app)/plan/changes-actions";
import { computeMorningCheck } from "@/app/(app)/morning-check/actions";
import { WeekChangesBanner } from "@/components/week-changes-banner";
import { WeekSummary } from "@/components/week-summary";
import { WeekChatPanel } from "@/components/week-chat-panel";
import { StartsThisWeekList } from "@/components/starts-this-week";
import { loadChatHistory } from "@/app/(app)/chat/actions";
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
  // v3 (plan-first), brief 3.4: once accepted, changes surface as a banner
  // instead of silently rebuilding — only computed for an accepted week.
  const weekChanges = data.weekStatus === "saved" ? await computeWeekChanges(data.weekStart) : null;
  // v3 (plan-first) stage 6, brief 9.3: the morning check runs on every
  // open instead of behind a button — same pattern as refreshDraftWeek.
  const morningCheck = await computeMorningCheck();
  const chatHistory = await loadChatHistory();

  return (
    <div>
      <h1 className="text-lg font-semibold">Week</h1>
      <div className="mt-6">
        <SyncBar asana={data.asanaStatus} calendar={data.calendarStatus} />
        {weekChanges && <WeekChangesBanner initial={weekChanges} />}
        <WeekSummary data={data} nowMinutes={nowLocal.minutesFromMidnight} />
        <WeekChatPanel initialHistory={chatHistory} />
        <StartsThisWeekList items={data.startsThisWeek} />
        <Dashboard
          weekCapacityHours={data.weekCapacityHours}
          weekPlannedHours={data.weekPlannedHours}
          weekSuggestedHours={data.weekSuggestedHours}
          breakdown={data.breakdown}
        />
        <MorningCheckPanel initial={morningCheck} />
        <PlanBoard
          weekStart={data.weekStart}
          weekStatus={data.weekStatus}
          todayStr={data.todayStr}
          days={data.capacityDays}
          followingDays={data.followingCapacityDays}
          thisWeekTasks={data.thisWeekTasks}
          shoots={data.shoots}
          rejectedKeys={data.rejectedKeys}
        />
        <EverythingElseList weekStart={data.weekStart} groups={data.everythingElseGroups} parkedGids={data.parkedKeys} />
      </div>
    </div>
  );
}
