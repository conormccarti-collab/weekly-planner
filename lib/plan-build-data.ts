import type { SupabaseClient } from "@supabase/supabase-js";
import { stableHash } from "@/lib/input-hash";
import { groupTasksByRoot, isInBacklog, type TaskRow } from "@/lib/asana/task-view";
import { partitionByEligibility } from "@/lib/asana/eligibility";
import { isStale } from "@/lib/stale";
import { computeStageInfo, videoTypeOf, type StageInfo } from "@/lib/asana/stage-context";
import { computeDeliverableLatestStarts, flatCapacityForDate } from "@/lib/back-scheduling-data";
import { STAGES } from "@/lib/asana/stage";
import { resolveEstimatesForTasks, type EstimateTarget } from "@/lib/estimates-data";
import { placementHours, type EstimateResult } from "@/lib/estimates";
import { suggestEstimateHours } from "@/lib/chat/claude";
import { resolvePriority } from "@/lib/priority";
import { isDueThisWeekOrOverdue } from "@/lib/plan";
import { loadSettings } from "@/lib/settings-data";
import { getWeekCapacity } from "@/lib/calendar/week-capacity";
import { subtractOccupied, type Range } from "@/lib/blocks";
import { partitionProtected, behindRemainderCandidates, type BuildCandidate, type ExistingRow } from "@/lib/plan-build";
import type { FreeBlock } from "@/lib/auto-placement";
import { addDaysToDateStr, mondayOf, parseHHMM, utcInstantToLocal } from "@/lib/time";
import { env } from "@/lib/env";

export type ExistingDbRow = {
  id: string;
  source: "asana" | "personal";
  reference: string;
  day: string | null;
  must: boolean;
  status: string;
  pinned: boolean;
  start_time: string | null;
  end_time: string | null;
  hours: number | null;
};

export type WeekBuildInputs = {
  candidates: BuildCandidate[];
  needsEstimatePick: { source: "asana" | "personal"; reference: string }[];
  nameByKey: Map<string, string>;
  mustByKey: Map<string, boolean>;
  existingRows: ExistingDbRow[];
  protectedKeys: Set<string>;
  freeBlocksByDay: Map<string, FreeBlock[]>;
  dayOrder: string[];
  weekCapacityHours: number;
  completedByGid: Map<string, boolean>;
  toRank: BuildCandidate[];
  inputHash: string;
  /** v5 Stage 12d.4: deliverables overdue by more than 14 days — never placed, never At risk. */
  staleItems: { source: "asana"; reference: string; name: string; dueOn: string | null }[];
  /** v5 Stage 12e.1: slots a user just rejected a block from — never re-proposed in the same slot. */
  avoidSlotByKey: Map<string, { day: string; startMinutes: number }>;
};

/**
 * The shared data-gathering behind both the silent draft-week build/refresh
 * and the accepted-week "things changed" dry-run diff (stage 1 and 2) — one
 * assembly of "what should be in this week," reused by both call sites so
 * they can't quietly drift apart.
 *
 * `treatAllExistingAsProtected`: once a week is accepted, every existing row
 * is implicitly approved by that acceptance, not just pinned ones — the
 * diff is about what's new, not about re-litigating what's already there.
 */
export async function gatherWeekBuildInputs(
  supabase: SupabaseClient,
  userId: string,
  weekStart: string,
  options?: { treatAllExistingAsProtected?: boolean }
): Promise<WeekBuildInputs> {
  const timezone = env.appTimezone();
  const todayStr = utcInstantToLocal(new Date(), timezone).dateStr;
  const weekEndExclusive = addDaysToDateStr(weekStart, 7);
  const settings = await loadSettings(supabase, userId);

  const [tasksResult, personalResult, metaResult, existingResult, weekCapacity] = await Promise.all([
    supabase
      .from("asana_tasks")
      .select(
        "gid, name, parent_gid, parent_name, project_gids, project_names, section_names, due_on, start_on, completed, custom_fields, permalink_url, assignee_name, is_container, is_plannable, is_shoot, no_longer_assigned, blocked_by_gids"
      )
      .eq("completed", false)
      .eq("no_longer_assigned", false),
    supabase.from("personal_tasks").select("id, name, estimate_hours, priority, due_on").eq("user_id", userId).eq("completed", false),
    supabase.from("task_meta").select("source, reference, parked, priority_override, remaining_hours").eq("user_id", userId),
    supabase
      .from("plan_items")
      .select("id, source, reference, day, must, status, pinned, start_time, end_time, hours")
      .eq("user_id", userId)
      .eq("week_start", weekStart),
    getWeekCapacity(supabase, userId, timezone, settings, weekStart, { useActualStarts: weekStart === mondayOf(todayStr) }),
  ]);

  // A failed read here must never be silently treated as "nothing exists
  // yet" — that previously made every unprotected row look protected by
  // omission, so each call piled on a fresh duplicate set instead of
  // replacing the last one.
  if (tasksResult.error) throw new Error(`Failed to load tasks: ${tasksResult.error.message}`);
  if (personalResult.error) throw new Error(`Failed to load personal tasks: ${personalResult.error.message}`);
  if (metaResult.error) throw new Error(`Failed to load task_meta: ${metaResult.error.message}`);
  if (existingResult.error) throw new Error(`Failed to load existing plan_items: ${existingResult.error.message}`);

  const allTasks = (tasksResult.data as TaskRow[]) ?? [];
  const personalTasks = personalResult.data ?? [];
  const metaRows = metaResult.data ?? [];
  const parkedKeys = new Set(metaRows.filter((r) => r.parked).map((r) => `${r.source}:${r.reference}`));
  const priorityOverrideByRef = new Map(
    metaRows.filter((r) => r.priority_override != null).map((r) => [r.reference, r.priority_override as string])
  );
  // v4: "Behind with hours left" — the Behind block itself stays protected
  // as history (brief 3.5's protection rule, unchanged); this is the
  // task's still-unplaced remainder.
  const remainingHoursByKey = new Map(
    metaRows.filter((r) => r.remaining_hours != null).map((r) => [`${r.source}:${r.reference}`, Number(r.remaining_hours)])
  );
  const existingRows = (existingResult.data ?? []) as ExistingDbRow[];

  // v5 Stage 12e.1: "regeneration does not put it back in the same slot" a
  // user just rejected it from. A separate, best-effort read (not part of
  // the throw-on-error batch above) — migration 0024 may not be applied
  // yet, and a missing avoid-slot is a silent no-op, not a build failure.
  const avoidSlotByKey = new Map<string, { day: string; startMinutes: number }>();
  const { data: rejectionRows } = await supabase
    .from("plan_events")
    .select("source, reference, day, start_time")
    .eq("user_id", userId)
    .eq("week_start", weekStart)
    .eq("event_type", "rejected");
  for (const r of rejectionRows ?? []) {
    if (r.day == null || r.start_time == null) continue;
    avoidSlotByKey.set(`${r.source}:${r.reference}`, { day: r.day as string, startMinutes: parseHHMM(r.start_time as string) });
  }

  // v5 Stage 12c: a fingerprint of every raw input the build depends on, so
  // `refreshDraftWeek` can tell "nothing changed since last time" and skip
  // the rebuild (and its write) entirely, rather than recomputing and
  // rewriting identical rows on every call.
  const inputHash = stableHash({
    tasks: [...allTasks].sort((a, b) => a.gid.localeCompare(b.gid)),
    personal: [...personalTasks].sort((a, b) => a.id.localeCompare(b.id)),
    meta: [...metaRows].sort((a, b) => `${a.source}:${a.reference}`.localeCompare(`${b.source}:${b.reference}`)),
    existing: [...existingRows].sort((a, b) => a.id.localeCompare(b.id)),
    weekCapacity,
    settings,
  });

  // v5 Stage 12d: "Plan only: tasks and subtasks in Visual Content Pipeline
  // whose parent is not completed, tasks in Production & Shoots, and
  // personal tasks" — everything else is never placed, never counted, never
  // flagged. A deliverable overdue by more than 14 days is "Stale" instead
  // (12d.4): also never placed or counted, surfaced separately so it's never
  // silently dropped.
  const { eligible: inWorkflowGroups } = partitionByEligibility(
    groupTasksByRoot(allTasks).filter((g) => !isInBacklog(g.root)),
    settings.planned_project_gids
  );
  const staleGroups = inWorkflowGroups.filter((g) => isStale(g.root.due_on, todayStr));
  const visibleGroups = inWorkflowGroups.filter((g) => !isStale(g.root.due_on, todayStr));
  const staleItems = staleGroups.map((g) => ({ source: "asana" as const, reference: g.root.gid, name: g.root.name, dueOn: g.root.due_on }));
  const stageInfoByGroup = visibleGroups.map((g) => computeStageInfo(g));
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
    for (const [gid, info] of stageInfoByGroup[i]) stageInfoByRef.set(gid, info);
  });

  const mustByKey = new Map<string, boolean>();
  for (const r of existingRows) {
    if (r.must) mustByKey.set(`${r.source}:${r.reference}`, true);
  }

  const eligibleAsanaGids = new Set<string>();
  for (const [gid, task] of taskByRef) {
    if (task.is_container || !task.is_plannable) continue;
    const key = `asana:${gid}`;
    if (parkedKeys.has(key)) continue;
    const isMust = mustByKey.get(key) ?? false;
    if (isMust || isDueThisWeekOrOverdue(task.due_on, weekEndExclusive)) eligibleAsanaGids.add(gid);
  }
  const eligiblePersonal = personalTasks.filter((t) => {
    const key = `personal:${t.id}`;
    if (parkedKeys.has(key)) return false;
    const isMust = mustByKey.get(key) ?? false;
    return isMust || isDueThisWeekOrOverdue(t.due_on, weekEndExclusive);
  });

  const targets: EstimateTarget[] = [];
  for (const gid of eligibleAsanaGids) {
    const task = taskByRef.get(gid)!;
    const focusType = stageInfoByRef.get(gid)?.focusType ?? null;
    if (focusType === "away" || focusType === "waiting") continue;
    targets.push({ source: "asana", reference: gid, stage: (stageInfoByRef.get(gid)?.stage as EstimateTarget["stage"]) ?? null, videoType: videoTypeOf(task) });
  }
  const estimatesByKey = await resolveEstimatesForTasks(supabase, userId, targets);
  const targetByKey = new Map(targets.map((t) => [`${t.source}:${t.reference}`, t]));

  // v4 Stage 4b: back-scheduling needs every stage's estimate for any
  // deliverable with a publish date — not just this week's eligible
  // candidates, since a stage months out still needs a confirmed figure to
  // compute a latest start for the stages before it. A separate, small
  // resolution pass, scoped to exactly those extra tasks.
  const deliverableGroups = visibleGroups.filter((g) => g.root.due_on != null);
  const backSchedulingTargets: EstimateTarget[] = [];
  for (const group of deliverableGroups) {
    for (const task of group.descendants) {
      if (!task.is_plannable || targets.some((t) => t.reference === task.gid)) continue;
      const info = stageInfoByRef.get(task.gid);
      if (!info?.stage) continue;
      backSchedulingTargets.push({ source: "asana", reference: task.gid, stage: info.stage, videoType: videoTypeOf(task) });
    }
  }
  const backSchedulingEstimatesByKey =
    backSchedulingTargets.length > 0 ? await resolveEstimatesForTasks(supabase, userId, backSchedulingTargets) : new Map();
  const allEstimatesForBackScheduling = new Map([...estimatesByKey, ...backSchedulingEstimatesByKey]);

  const capacityForDate = flatCapacityForDate(settings.working_days, settings.hours_per_day);
  const latestStartByGid = new Map<string, string>();
  for (const group of deliverableGroups) {
    const result = computeDeliverableLatestStarts(group, stageInfoByRef, allEstimatesForBackScheduling, capacityForDate);
    if (result?.ok) {
      for (const s of result.starts) {
        if (s.latestStartDate) latestStartByGid.set(s.gid, s.latestStartDate);
      }
    }
  }

  /**
   * v4 Stage 2, brief section 5.1, tier 4: the last resort before a task is
   * left unestimated. Only called for a task that resolved to "none" with
   * no ambiguous default to pick from — i.e. genuinely nothing else to go
   * on. A successful suggestion is cached to `task_meta` immediately so it
   * never needs a second model call, and so it shows up everywhere else in
   * the app that reads estimates (task lists, Projects) as a "suggested"
   * tier-4 value, not just inside this build pass.
   */
  async function withSuggestion(
    source: "asana" | "personal",
    reference: string,
    estimate: EstimateResult,
    name: string
  ): Promise<EstimateResult> {
    if (estimate.origin !== "none" || (estimate.ambiguousOptions && estimate.ambiguousOptions.length > 0)) return estimate;
    const target = targetByKey.get(`${source}:${reference}`);
    const hours = await suggestEstimateHours(name, target?.stage ?? null, target?.videoType ?? null);
    if (hours == null) return estimate;
    await supabase.from("task_meta").upsert({
      user_id: userId,
      source,
      reference,
      stage: target?.stage ?? null,
      video_type: target?.videoType ?? null,
      estimate_hours: hours,
      estimate_origin: "suggested",
      updated_at: new Date().toISOString(),
    });
    return { hours, origin: "suggested", label: "suggested" };
  }

  const candidates: BuildCandidate[] = [];
  const needsEstimatePick: { source: "asana" | "personal"; reference: string }[] = [];
  const nameByKey = new Map<string, string>();

  for (const gid of eligibleAsanaGids) {
    const task = taskByRef.get(gid)!;
    nameByKey.set(`asana:${gid}`, task.name);
    const stageInfo = stageInfoByRef.get(gid);
    const focusType = stageInfo?.focusType ?? null;
    if (focusType === "away" || focusType === "waiting") continue; // fixed 0h — never placed
    const key = `asana:${gid}`;
    const rawEstimate = estimatesByKey.get(key) ?? { hours: null, origin: "none" as const, label: "needs estimate" };
    const estimate = await withSuggestion("asana", gid, rawEstimate, task.name);
    const placement = placementHours(estimate);
    if (placement == null) {
      needsEstimatePick.push({ source: "asana", reference: gid });
      continue;
    }
    const must = mustByKey.get(key) ?? false;
    candidates.push({
      source: "asana",
      reference: gid,
      rootRef: rootRefByGid.get(gid) ?? gid,
      stageOrder: stageInfo?.stage ? Math.max(0, STAGES.indexOf(stageInfo.stage as (typeof STAGES)[number])) : 0,
      must,
      hasHardDeadline: (rootDueOnByGid.get(gid) ?? null) != null || must,
      latestStartDate: latestStartByGid.get(gid) ?? null,
      dueOn: task.due_on,
      priority: resolvePriority(task.custom_fields["Priority"] ?? null, priorityOverrideByRef.get(gid) ?? null),
      focusType: (focusType as "deep" | "shallow" | "away" | "waiting" | null) ?? "shallow",
      estimateHours: placement.hours,
      blockedByGids: task.blocked_by_gids ?? [],
      isSuggested: placement.isSuggested,
    });
  }

  for (const t of eligiblePersonal) {
    const key = `personal:${t.id}`;
    nameByKey.set(key, t.name);
    const rawEstimate: EstimateResult =
      t.estimate_hours != null
        ? { hours: t.estimate_hours, origin: "user", label: "your estimate" }
        : { hours: null, origin: "none", label: "needs estimate" };
    const estimate = await withSuggestion("personal", t.id, rawEstimate, t.name);
    const placement = placementHours(estimate);
    if (placement == null) {
      needsEstimatePick.push({ source: "personal", reference: t.id });
      continue;
    }
    const must = mustByKey.get(key) ?? false;
    candidates.push({
      source: "personal",
      reference: t.id,
      rootRef: t.id,
      stageOrder: 0,
      must,
      hasHardDeadline: must, // no parent-deliverable publish date concept for personal tasks
      dueOn: t.due_on,
      priority: t.priority,
      focusType: "shallow",
      estimateHours: placement.hours,
      blockedByGids: [],
      isSuggested: placement.isSuggested,
    });
  }

  const existingForPartition: ExistingRow[] = existingRows
    .filter((r) => r.status !== "moved")
    .map((r) => ({
      key: `${r.source}:${r.reference}`,
      day: r.day,
      pinned: options?.treatAllExistingAsProtected ? true : (r.pinned ?? false),
      status: r.status,
    }));
  const { protectedKeys } = partitionProtected(existingForPartition, todayStr);

  const toRank = candidates.filter((c) => !protectedKeys.has(`${c.source}:${c.reference}`));

  // v4, "Behind with hours left" — see `behindRemainderCandidates` for the
  // full reasoning; this just adapts `existingRows`' shape for it.
  toRank.push(
    ...behindRemainderCandidates(
      candidates,
      existingRows.map((r) => ({ key: `${r.source}:${r.reference}`, day: r.day, pinned: r.pinned, status: r.status, hours: r.hours })),
      remainingHoursByKey
    )
  );

  const protectedOccupiedByDay = new Map<string, Range[]>();
  for (const r of existingRows) {
    const key = `${r.source}:${r.reference}`;
    if (!protectedKeys.has(key) || r.day == null || !r.start_time || !r.end_time) continue;
    const list = protectedOccupiedByDay.get(r.day) ?? [];
    list.push({ startMinutes: parseHHMM(r.start_time), endMinutes: parseHHMM(r.end_time) });
    protectedOccupiedByDay.set(r.day, list);
  }
  const freeBlocksByDay = new Map<string, FreeBlock[]>();
  const dayOrder = weekCapacity.filter((d) => d.isWorkingDay).map((d) => d.dateStr);
  for (const day of weekCapacity) {
    freeBlocksByDay.set(day.dateStr, subtractOccupied(day.freeBlocks, protectedOccupiedByDay.get(day.dateStr) ?? []));
  }
  const weekCapacityHours = weekCapacity.reduce((sum, d) => sum + d.plannedCapacityHours, 0);

  const allBlockerGids = [...new Set(toRank.flatMap((c) => c.blockedByGids))];
  let completedByGid = new Map<string, boolean>();
  if (allBlockerGids.length > 0) {
    const { data: blockerRows } = await supabase.from("asana_tasks").select("gid, completed").in("gid", allBlockerGids);
    completedByGid = new Map((blockerRows ?? []).map((r) => [r.gid as string, r.completed as boolean]));
  }

  return { candidates, needsEstimatePick, nameByKey, mustByKey, existingRows, protectedKeys, freeBlocksByDay, dayOrder, weekCapacityHours, completedByGid, toRank, inputHash, staleItems, avoidSlotByKey };
}
