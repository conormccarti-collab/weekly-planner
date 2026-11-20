import { createClient } from "@/lib/supabase/server";
import { SyncBar } from "@/components/sync-bar";
import { Dashboard } from "@/components/dashboard";
import { MorningCheckPanel } from "@/components/morning-check-panel";
import { PlanBoard } from "@/components/plan-board";
import { EverythingElseList } from "@/components/everything-else-list";
import { loadWeekViewData } from "@/lib/week-view-data";
import { refreshDraftWeek } from "@/app/(app)/plan/build-actions";
import { computeWeekChanges } from "@/app/(app)/plan/changes-actions";
import { computeMorningCheck } from "@/app/(app)/morning-check/actions";
import { WeekChangesBanner } from "@/components/week-changes-banner";
import { WeekSummary } from "@/components/week-summary";
import { addDaysToDateStr, mondayOf, utcInstantToLocal } from "@/lib/time";
import { env } from "@/lib/env";

export default async function WeekPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;

  if (!user) {
    return <h1 className="text-lg font-semibold">Week</h1>;
  }

  // v3 (plan-first), brief 3.1/4.1: the week is already laid out as a
  // proposed plan when the app opens — no button needed. A `saved` week is
  // left untouched by this (refreshDraftWeek no-ops for it).
  const nowLocal = utcInstantToLocal(new Date(), env.appTimezone());
  const todayStr = nowLocal.dateStr;
  const weekStart = mondayOf(todayStr);
  const followingWeekStart = addDaysToDateStr(weekStart, 7);
  await refreshDraftWeek(weekStart);
  await refreshDraftWeek(followingWeekStart);

  const data = await loadWeekViewData(supabase, user);
  // v3 (plan-first), brief 3.4: once accepted, changes surface as a banner
  // instead of silently rebuilding — only computed for an accepted week.
  const weekChanges = data.weekStatus === "saved" ? await computeWeekChanges(data.weekStart) : null;
  // v3 (plan-first) stage 6, brief 9.3: the morning check runs on every
  // open instead of behind a button — same pattern as refreshDraftWeek.
  const morningCheck = await computeMorningCheck();

  return (
    <div>
      <h1 className="text-lg font-semibold">Week</h1>
      <div className="mt-6">
        <SyncBar asana={data.asanaStatus} calendar={data.calendarStatus} />
        {weekChanges && <WeekChangesBanner initial={weekChanges} />}
        <WeekSummary data={data} nowMinutes={nowLocal.minutesFromMidnight} />
        <Dashboard
          weekCapacityHours={data.weekCapacityHours}
          weekPlannedHours={data.weekPlannedHours}
          weekProvisionalHours={data.weekProvisionalHours}
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
        />
        <EverythingElseList weekStart={data.weekStart} groups={data.everythingElseGroups} parkedGids={data.parkedKeys} />
      </div>
    </div>
  );
}
