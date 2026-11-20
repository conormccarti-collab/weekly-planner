import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { SyncSourceStatus } from "@/components/sync-bar";
import { groupTasksByRoot, isInBacklog, type TaskRow } from "@/lib/asana/task-view";
import { partitionByEligibility } from "@/lib/asana/eligibility";
import { isStale } from "@/lib/stale";
import { computeStageInfo, videoTypeOf, type StageInfo } from "@/lib/asana/stage-context";
import { resolveEstimatesForTasks, type EstimateTarget } from "@/lib/estimates-data";
import { loadSettings } from "@/lib/settings-data";
import { ensureDayStartRecorded, getWeekCapacity, type DayCapacityView } from "@/lib/calendar/week-capacity";
import { ensureWeekInitialized, loadWeekPlan, type PlacedItem } from "@/lib/plan-data";
import { computeStageBreakdown, isDueThisWeekOrOverdue, type StageBreakdownRow } from "@/lib/plan";
import { computeFinalBlockIds } from "@/lib/blocks";
import { toPlannerTask, toPersonalPlannerTask, type PersonalTaskRow } from "@/lib/planner-view";
import { expandShootDateSpan, matchShootToCalendarEvent, type CalendarEventForMatch, type ShootMarker } from "@/lib/asana/shoots";
import type { EverythingElseGroup, Placement, PlannerTask } from "@/lib/planner-types";
import { addDaysToDateStr, mondayOf, utcInstantToLocal, type Weekday } from "@/lib/time";
import { env } from "@/lib/env";
import { checkBrand, checkColumnMatchesStage, checkGroupDates, checkVideoType, isGenuinePipelineDeliverable } from "@/lib/hygiene";
import { isBlocked } from "@/lib/asana/dependencies";
import { computeDeliverableLatestStarts, flatCapacityForDate } from "@/lib/back-scheduling-data";
import { seriesNameOf } from "@/lib/asana/discovery";
import { orderCandidatesForPlacement, type AutoPlaceCandidate } from "@/lib/auto-placement";
import { resolvePriority } from "@/lib/priority";
import { STAGES } from "@/lib/asana/stage";

export type WeekViewData = {
  asanaStatus: SyncSourceStatus;
  calendarStatus: SyncSourceStatus;
  capacityDays: DayCapacityView[];
  followingCapacityDays: DayCapacityView[];
  thisWeekTasks: PlannerTask[];
  everythingElseGroups: EverythingElseGroup[];
  parkedKeys: Set<string>;
  todayStr: string;
  weekStart: string;
  followingWeekStart: string;
  weekStatus: "draft" | "saved";
  weekCapacityHours: number;
  /** Excludes suggested-status hours — brief 5.1: "excluded from the counted week total, from 'planned' hours." */
  weekPlannedHours: number;
  /** v4 Stage 2, brief 5.1: hours placed with a model-suggested (unconfirmed) estimate, shown as "plus X suggested" alongside weekPlannedHours rather than folded into it. */
  weekSuggestedHours: number;
  breakdown: StageBreakdownRow[];
  saveRefs: { source: "asana" | "personal"; reference: string; must: boolean }[];
  shoots: ShootMarker[];
  /** v5 Stage 12e.1: tasks rejected from a slot this week — shown in Unplaced so a reject isn't silently indistinguishable from "no room". */
  rejectedKeys: Set<string>;
  /** Composite source:reference keys genuinely committed to this week — see the note where it's built. */
  thisWeekOnlyKeys: Set<string>;
  /** v3 (plan-first) stage 4: for the summary panel's deadline-within-N-working-days check. */
  workingDays: Weekday[];
  /** v4 Stage 2, brief 5.6: hygiene flags on this week's deliverables, for the summary panel. */
  weekHygieneIssues: string[];
  /** v4 Stage 4b, brief 7.4.7: deliverable stages whose back-scheduled latest start falls this week or has passed. */
  startsThisWeek: { rootRef: string; deliverableName: string; stage: string; latestStartDate: string; isPastDue: boolean }[];
  /** v3 (plan-first) stage 4, summary section 5: next week's draft, unplaced (no room / needs estimate). */
  followingWeekUnplaced: { source: "asana" | "personal"; reference: string; name: string }[];
  /** v3 (plan-first) stage 4, summary section 5: the three highest-ranked items actually placed into next week's draft. */
  followingWeekTopRanked: { source: "asana" | "personal"; reference: string; name: string }[];
  followingWeekPlannedHours: number;
  followingWeekCapacityHours: number;
};

/**
 * Everything the Week screen needs, computed once. v3 (plan-first) stage 6
 * retired the separate Planning session screen — its steps now live here.
 */
export async function loadWeekViewData(supabase: SupabaseClient, user: User): Promise<WeekViewData> {
  const todayStr = utcInstantToLocal(new Date(), env.appTimezone()).dateStr;
  const weekStart = mondayOf(todayStr);
  const followingWeekStart = addDaysToDateStr(weekStart, 7);

  const settings = await loadSettings(supabase, user.id);
  await ensureDayStartRecorded(supabase, user.id, env.appTimezone(), settings);
  await ensureWeekInitialized(supabase, user.id, weekStart);
  await ensureWeekInitialized(supabase, user.id, followingWeekStart);

  const [
    tasksResult,
    personalResult,
    parkedResult,
    asanaSyncResult,
    calendarSyncResult,
    weekCapacity,
    followingWeekCapacity,
    plan,
    followingPlan,
  ] = await Promise.all([
    supabase
      .from("asana_tasks")
      .select(
        "gid, name, parent_gid, parent_name, project_gids, project_names, section_names, due_on, start_on, completed, custom_fields, permalink_url, assignee_name, is_container, is_plannable, is_shoot, no_longer_assigned, blocked_by_gids"
      )
      .eq("completed", false)
      .eq("no_longer_assigned", false),
    supabase
      .from("personal_tasks")
      .select("id, name, estimate_hours, priority, due_on")
      .eq("user_id", user.id)
      .eq("completed", false),
    supabase.from("task_meta").select("source, reference, parked, priority_override").eq("user_id", user.id),
    supabase
      .from("sync_log")
      .select("finished_at, ok, error")
      .eq("source", "asana")
      .order("finished_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("sync_log")
      .select("finished_at, ok, error")
      .eq("source", "calendar")
      .order("finished_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
    getWeekCapacity(supabase, user.id, env.appTimezone(), settings, weekStart, { useActualStarts: true }),
    getWeekCapacity(supabase, user.id, env.appTimezone(), settings, followingWeekStart, { useActualStarts: false }),
    loadWeekPlan(supabase, user.id, weekStart),
    loadWeekPlan(supabase, user.id, followingWeekStart),
  ]);

  const allTasks = (tasksResult.data as TaskRow[]) ?? [];
  const personalTasks = (personalResult.data as PersonalTaskRow[]) ?? [];
  const taskMetaRows = parkedResult.data ?? [];
  const parkedKeys = new Set(taskMetaRows.filter((r) => r.parked).map((r) => `${r.source}:${r.reference}`));
  const priorityOverrideByRef = new Map(
    taskMetaRows.filter((r) => r.priority_override != null).map((r) => [r.reference, r.priority_override as string])
  );

  // v5 Stage 12e.1: "keeps the task in the Unplaced list with its reason."
  // Best-effort — migration 0024 may not be applied yet.
  const { data: rejectionRows } = await supabase
    .from("plan_events")
    .select("source, reference")
    .eq("user_id", user.id)
    .eq("week_start", weekStart)
    .eq("event_type", "rejected");
  const rejectedKeys = new Set((rejectionRows ?? []).map((r) => `${r.source}:${r.reference}`));

  // v2 (18 Nov 2026), item B.9: show shoots on the calendar by date, reading
  // Shoot Type / Location if present — nothing fails if they're absent.
  // v4 Stage 4a, brief 7.4a: also match each shoot to a real calendar event
  // (read-only — never creates or edits one) so an unmatched shoot can be
  // flagged on Hygiene.
  const shootTasks = allTasks.filter((t) => t.is_shoot);
  const shootSpanByGid = new Map(shootTasks.map((t) => [t.gid, expandShootDateSpan(t.start_on, t.due_on)]));
  const allShootDates = [...new Set([...shootSpanByGid.values()].flat())].sort();
  let calendarEventsForShoots: CalendarEventForMatch[] = [];
  if (allShootDates.length > 0) {
    const { data: eventRows } = await supabase
      .from("calendar_events")
      .select("title, all_day, start_date, end_date, starts_at, busy, response_status")
      .eq("user_id", user.id)
      .or(`and(all_day.eq.true,start_date.lte.${allShootDates[allShootDates.length - 1]},end_date.gte.${allShootDates[0]}),and(all_day.eq.false,starts_at.gte.${allShootDates[0]}T00:00:00Z,starts_at.lte.${allShootDates[allShootDates.length - 1]}T23:59:59Z)`);
    calendarEventsForShoots = (eventRows ?? []).map((r) => ({
      title: r.title as string,
      allDay: r.all_day as boolean,
      startDate: r.start_date as string | null,
      endDate: r.end_date as string | null,
      startsAt: r.starts_at as string | null,
      busy: r.busy as boolean,
      responseStatus: r.response_status as string | null,
    }));
  }
  const shoots: ShootMarker[] = shootTasks.flatMap((t) => {
    const span = shootSpanByGid.get(t.gid) ?? [];
    const matchedEvent = matchShootToCalendarEvent(t.name, span, calendarEventsForShoots);
    return span.map((dateStr) => ({
      gid: t.gid,
      name: t.name,
      dateStr,
      shootType: t.custom_fields["Shoot Type"] ?? null,
      location: t.custom_fields["Location"] ?? null,
      matchedEventTitle: matchedEvent?.title ?? null,
    }));
  });

  // v1.3: Backlog is pre-active work, hidden from planning by default —
  // drop the whole group (container + subtasks) when its root is there.
  // v5 Stage 12d: same eligibility gate as the build (plan-build-data.ts) —
  // "never placed, never counted as At risk, never flagged by Hygiene" for
  // anything outside the planned projects, and the same for a Stale
  // (14+ days overdue) deliverable.
  const allGroups = groupTasksByRoot(allTasks);
  const { eligible: inWorkflowGroups } = partitionByEligibility(
    allGroups.filter((g) => !isInBacklog(g.root)),
    settings.planned_project_gids
  );
  const visibleGroups = inWorkflowGroups.filter((g) => !isStale(g.root.due_on, todayStr));

  const stageInfoByGroup = visibleGroups.map((group) => computeStageInfo(group));
  const taskByRef = new Map<string, TaskRow>();
  const stageInfoByRef = new Map<string, StageInfo>();
  const rootRefByGid = new Map<string, string>();
  const rootDueOnByGid = new Map<string, string | null>();
  visibleGroups.forEach((group, i) => {
    for (const task of [group.root, ...group.descendants]) {
      taskByRef.set(task.gid, task);
      rootRefByGid.set(task.gid, group.root.gid);
      rootDueOnByGid.set(task.gid, group.root.due_on);
    }
    for (const [gid, info] of stageInfoByGroup[i]) {
      stageInfoByRef.set(gid, info);
    }
  });
  const personalByRef = new Map(personalTasks.map((t) => [t.id, t]));

  const targets: EstimateTarget[] = [];
  for (const [gid, task] of taskByRef) {
    if (task.is_container || !task.is_plannable) continue;
    const focusType = stageInfoByRef.get(gid)?.focusType ?? null;
    if (focusType === "away" || focusType === "waiting") continue; // fixed 0h, no estimate needed
    targets.push({
      source: "asana",
      reference: gid,
      stage: stageInfoByRef.get(gid)?.stage ?? null,
      videoType: videoTypeOf(task),
    });
  }
  const estimatesByKey = await resolveEstimatesForTasks(supabase, user.id, targets);

  // v4 Stage 4b, brief 7.4.7: "Show results on the Week screen as a short
  // 'Starts this week' list" — a stage whose latest start falls within this
  // week or has already passed.
  const weekEndExclusiveForBackScheduling = addDaysToDateStr(weekStart, 7);
  const capacityForBackScheduling = flatCapacityForDate(settings.working_days, settings.hours_per_day);
  const startsThisWeek: { rootRef: string; deliverableName: string; stage: string; latestStartDate: string; isPastDue: boolean }[] = [];
  for (const group of visibleGroups) {
    if (!group.root.due_on) continue;
    const result = computeDeliverableLatestStarts(group, stageInfoByRef, estimatesByKey, capacityForBackScheduling);
    if (!result?.ok) continue;
    for (const s of result.starts) {
      if (!s.latestStartDate || s.latestStartDate >= weekEndExclusiveForBackScheduling) continue;
      startsThisWeek.push({
        rootRef: group.root.gid,
        deliverableName: group.root.name,
        stage: s.stage,
        latestStartDate: s.latestStartDate,
        isPastDue: s.latestStartDate < todayStr,
      });
    }
  }
  startsThisWeek.sort((a, b) => a.latestStartDate.localeCompare(b.latestStartDate));

  const weekStatus = plan.status;

  const allPlaced: PlacedItem[] = [...plan.placed, ...followingPlan.placed];
  const finalBlockIds = computeFinalBlockIds(allPlaced);

  const placementsByKey = new Map<string, Placement[]>();
  for (const item of allPlaced) {
    const key = `${item.source}:${item.reference}`;
    const list = placementsByKey.get(key) ?? [];
    list.push({
      id: item.id,
      day: item.day,
      startMinutes: item.startMinutes,
      endMinutes: item.endMinutes,
      hours: item.hours,
      actualHours: item.actualHours,
      status: item.status,
      isFinal: finalBlockIds.has(item.id),
      pinned: item.pinned,
    });
    placementsByKey.set(key, list);
  }
  const mustByKey = new Map<string, boolean>();
  for (const item of [...plan.placed, ...plan.unplaced, ...followingPlan.placed, ...followingPlan.unplaced]) {
    mustByKey.set(`${item.source}:${item.reference}`, item.must);
  }
  const planKeys = new Set<string>([
    ...placementsByKey.keys(),
    ...plan.unplaced.map((u) => `${u.source}:${u.reference}`),
    ...followingPlan.unplaced.map((u) => `${u.source}:${u.reference}`),
  ]);

  // Brief section 8: due this week or overdue — only auto-included while
  // the week is still a draft, so a saved plan reloads exactly.
  // `thisWeekOnlyKeys` tracks commitments genuinely tied to *this* week —
  // it deliberately excludes a task that's only present because it's
  // unplaced in the *following* week (e.g. just moved there by the
  // over-capacity proposal), so that feature can't immediately re-count
  // and re-propose moving the same task again.
  const thisWeekOnlyKeys = new Set<string>([
    ...plan.placed.map((p) => `${p.source}:${p.reference}`),
    ...plan.unplaced.map((u) => `${u.source}:${u.reference}`),
  ]);
  const thisWeekKeys = new Set<string>(planKeys);
  if (plan.status === "draft") {
    for (const [gid, task] of taskByRef) {
      const key = `asana:${gid}`;
      if (task.is_container || !task.is_plannable || parkedKeys.has(key) || plan.movedAwayRefs.has(key)) continue;
      if (isDueThisWeekOrOverdue(task.due_on, plan.weekEndExclusive)) {
        thisWeekKeys.add(key);
        thisWeekOnlyKeys.add(key);
      }
    }
    for (const task of personalTasks) {
      const key = `personal:${task.id}`;
      if (parkedKeys.has(key) || plan.movedAwayRefs.has(key)) continue;
      if (isDueThisWeekOrOverdue(task.due_on, plan.weekEndExclusive)) {
        thisWeekKeys.add(key);
        thisWeekOnlyKeys.add(key);
      }
    }
  }
  for (const key of [...thisWeekKeys]) {
    if (parkedKeys.has(key)) thisWeekKeys.delete(key);
  }
  for (const key of [...thisWeekOnlyKeys]) {
    if (parkedKeys.has(key)) thisWeekOnlyKeys.delete(key);
  }

  // Asana gids are numeric and personal references are uuids — neither
  // contains ":", so splitting on the first colon is unambiguous.
  const thisWeekAsanaRefs = new Set<string>();
  const thisWeekPersonalRefs = new Set<string>();
  for (const key of thisWeekKeys) {
    const [source, reference] = key.split(":");
    if (source === "asana") thisWeekAsanaRefs.add(reference);
    else thisWeekPersonalRefs.add(reference);
  }

  // v4 Stage 3, brief 6.2: "a task placed before the task that blocks it is
  // complete shows a warning on the block." A blocker already done is never
  // in `allTasks` (that query excludes completed rows entirely), so this
  // needs its own small lookup rather than reusing `taskByRef`.
  const thisWeekBlockerGids = [...new Set([...thisWeekAsanaRefs].flatMap((gid) => taskByRef.get(gid)?.blocked_by_gids ?? []))];
  let blockerCompletedByGid = new Map<string, boolean>();
  if (thisWeekBlockerGids.length > 0) {
    const { data: blockerRows } = await supabase.from("asana_tasks").select("gid, completed").in("gid", thisWeekBlockerGids);
    blockerCompletedByGid = new Map((blockerRows ?? []).map((r) => [r.gid as string, r.completed as boolean]));
  }

  const thisWeekTasks: PlannerTask[] = [
    ...[...thisWeekAsanaRefs]
      .map((gid) => taskByRef.get(gid))
      .filter((t): t is TaskRow => !!t)
      .map((task) =>
        toPlannerTask(
          task,
          stageInfoByRef.get(task.gid),
          estimatesByKey.get(`asana:${task.gid}`),
          mustByKey.get(`asana:${task.gid}`) ?? false,
          placementsByKey.get(`asana:${task.gid}`) ?? [],
          priorityOverrideByRef.get(task.gid) ?? null,
          rootRefByGid.get(task.gid) ?? task.gid,
          rootDueOnByGid.get(task.gid) ?? task.due_on,
          isBlocked(task.blocked_by_gids ?? [], blockerCompletedByGid)
        )
      ),
    ...[...thisWeekPersonalRefs]
      .map((id) => personalByRef.get(id))
      .filter((t): t is PersonalTaskRow => !!t)
      .map((task) =>
        toPersonalPlannerTask(
          task,
          mustByKey.get(`personal:${task.id}`) ?? false,
          placementsByKey.get(`personal:${task.id}`) ?? []
        )
      ),
  ].sort((a, b) => (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999") || a.name.localeCompare(b.name));

  // v4 Stage 2, brief section 5.6: "hygiene problems on this week's
  // deliverables" — same checks as the Hygiene screen, scoped to the
  // parent deliverables of whatever's in `thisWeekTasks`.
  const thisWeekRootRefs = new Set(thisWeekTasks.map((t) => t.rootRef));
  const weekHygieneIssues: string[] = [];
  for (const group of visibleGroups) {
    if (!thisWeekRootRefs.has(group.root.gid)) continue;
    // Same scoping as the Hygiene screen.
    if (!isGenuinePipelineDeliverable(group)) continue;
    for (const f of [...checkGroupDates(group), ...checkColumnMatchesStage(group), ...checkBrand(group.root), ...checkVideoType(group.root)]) {
      weekHygieneIssues.push(`${f.name}: ${f.issue}`);
    }
  }

  const everythingElseGroups: EverythingElseGroup[] = visibleGroups
    .map((group) => {
      const stageInfo = computeStageInfo(group);
      const rootInThisWeek = !group.root.is_container && thisWeekAsanaRefs.has(group.root.gid);
      if (rootInThisWeek) return null;

      const tasks = group.descendants
        .filter((t) => !t.is_container && !thisWeekAsanaRefs.has(t.gid))
        .map((t) =>
          toPlannerTask(
            t,
            stageInfo.get(t.gid),
            estimatesByKey.get(`asana:${t.gid}`),
            mustByKey.get(`asana:${t.gid}`) ?? false,
            placementsByKey.get(`asana:${t.gid}`) ?? [],
            priorityOverrideByRef.get(t.gid) ?? null,
            rootRefByGid.get(t.gid) ?? t.gid,
            rootDueOnByGid.get(t.gid) ?? t.due_on
          )
        );

      const nothingLeftToPlan =
        group.root.is_container && !group.descendants.some((t) => t.is_plannable && !thisWeekAsanaRefs.has(t.gid));

      if (group.root.is_container && tasks.length === 0 && !nothingLeftToPlan) return null;

      return {
        rootRef: group.root.gid,
        rootName: group.root.name,
        projectName: group.root.project_names.join(", "),
        isContainer: group.root.is_container,
        nothingLeftToPlan,
        tasks,
        seriesName: seriesNameOf(group.root.name),
      } satisfies EverythingElseGroup;
    })
    .filter((g): g is EverythingElseGroup => !!g);

  const personalElseTasks = personalTasks
    .filter((t) => !thisWeekPersonalRefs.has(t.id))
    .map((t) =>
      toPersonalPlannerTask(t, mustByKey.get(`personal:${t.id}`) ?? false, placementsByKey.get(`personal:${t.id}`) ?? [])
    );
  if (personalElseTasks.length > 0) {
    everythingElseGroups.push({
      rootRef: "personal-tasks",
      rootName: "Personal tasks",
      projectName: "Personal",
      isContainer: true,
      nothingLeftToPlan: false,
      tasks: personalElseTasks,
      seriesName: null,
    });
  }
  everythingElseGroups.sort((a, b) => a.rootName.localeCompare(b.rootName));

  // Dashboard (brief / calendar-redesign proposal section 7): stays scoped
  // to the current week even though thisWeekTasks' placements now span both
  // weeks' grids.
  const thisWeekOnlyTasks = thisWeekTasks.map((t) => ({
    ...t,
    placements: t.placements.filter((p) => p.day < followingWeekStart),
  }));
  const weekCapacityHours = weekCapacity.reduce((sum, d) => sum + d.plannedCapacityHours, 0);
  const weekPlannedHours = thisWeekOnlyTasks.reduce(
    (sum, t) => sum + t.placements.reduce((s, p) => s + (p.status === "suggested" ? 0 : p.hours), 0),
    0
  );
  const weekSuggestedHours = thisWeekOnlyTasks.reduce(
    (sum, t) => sum + t.placements.reduce((s, p) => s + (p.status === "suggested" ? p.hours : 0), 0),
    0
  );
  const breakdown = computeStageBreakdown(thisWeekOnlyTasks);

  // v3 (plan-first) stage 4, summary section 5: "the three highest-ranked
  // items" and "anything that cannot fit" for next week's draft — both
  // free from data already gathered above (followingPlan.placed/unplaced,
  // the task/stage maps), no new queries.
  // v5 Stage 12f.3: "Every subtask shows its parent" — applies to the
  // summary's next-week lists too, not just the calendar blocks.
  function nameFor(source: "asana" | "personal", reference: string): string {
    if (source === "personal") return personalByRef.get(reference)?.name ?? reference;
    const task = taskByRef.get(reference);
    if (!task) return reference;
    return task.parent_name ? `${task.parent_name} — ${task.name}` : task.name;
  }
  const followingWeekUnplaced = followingPlan.unplaced.map((u) => ({ source: u.source, reference: u.reference, name: nameFor(u.source, u.reference) }));
  const followingWeekPlannedHours = followingPlan.placed.reduce((sum, p) => sum + p.hours, 0);
  const followingWeekCapacityHours = followingWeekCapacity.reduce((sum, d) => sum + d.plannedCapacityHours, 0);

  const followingWeekCandidates: (AutoPlaceCandidate & { name: string })[] = followingPlan.placed.map((p) => {
    if (p.source === "asana") {
      const task = taskByRef.get(p.reference);
      const stageInfo = stageInfoByRef.get(p.reference);
      return {
        source: "asana",
        reference: p.reference,
        rootRef: rootRefByGid.get(p.reference) ?? p.reference,
        stageOrder: stageInfo?.stage ? Math.max(0, STAGES.indexOf(stageInfo.stage as (typeof STAGES)[number])) : 0,
        must: p.must,
        hasHardDeadline: (rootDueOnByGid.get(p.reference) ?? null) != null || p.must,
        dueOn: task?.due_on ?? null,
        priority: resolvePriority(task?.custom_fields["Priority"] ?? null, priorityOverrideByRef.get(p.reference) ?? null),
        focusType: (stageInfo?.focusType as AutoPlaceCandidate["focusType"]) ?? "shallow",
        estimateHours: p.hours,
        name: nameFor("asana", p.reference),
      };
    }
    const personalTask = personalByRef.get(p.reference);
    return {
      source: "personal",
      reference: p.reference,
      rootRef: p.reference,
      stageOrder: 0,
      must: p.must,
      hasHardDeadline: p.must,
      dueOn: personalTask?.due_on ?? null,
      priority: personalTask?.priority ?? null,
      focusType: "shallow",
      estimateHours: p.hours,
      name: nameFor("personal", p.reference),
    };
  });
  // Dedupe by key first (a split task can have more than one placed row).
  const seenFollowingKeys = new Set<string>();
  const dedupedFollowingCandidates = followingWeekCandidates.filter((c) => {
    const key = `${c.source}:${c.reference}`;
    if (seenFollowingKeys.has(key)) return false;
    seenFollowingKeys.add(key);
    return true;
  });
  const followingWeekTopRanked = orderCandidatesForPlacement(dedupedFollowingCandidates)
    .slice(0, 3)
    .map((c) => ({ source: c.source, reference: c.reference, name: (c as (typeof dedupedFollowingCandidates)[number]).name }));

  return {
    asanaStatus: {
      lastSyncedAt: asanaSyncResult.data?.finished_at ?? null,
      lastSyncError: asanaSyncResult.data?.ok === false ? asanaSyncResult.data.error : null,
    },
    calendarStatus: {
      lastSyncedAt: calendarSyncResult.data?.finished_at ?? null,
      lastSyncError: calendarSyncResult.data?.ok === false ? calendarSyncResult.data.error : null,
      needsReconnect: calendarSyncResult.data?.error === "RECONNECT_REQUIRED",
    },
    capacityDays: weekCapacity,
    followingCapacityDays: followingWeekCapacity,
    thisWeekTasks,
    everythingElseGroups,
    parkedKeys,
    todayStr,
    weekStart,
    followingWeekStart,
    weekStatus,
    weekCapacityHours,
    weekPlannedHours,
    weekSuggestedHours,
    breakdown,
    saveRefs: thisWeekTasks.map((t) => ({ source: t.source, reference: t.reference, must: t.must })),
    shoots,
    rejectedKeys,
    thisWeekOnlyKeys,
    workingDays: settings.working_days,
    weekHygieneIssues,
    startsThisWeek,
    followingWeekUnplaced,
    followingWeekTopRanked,
    followingWeekPlannedHours,
    followingWeekCapacityHours,
  };
}
