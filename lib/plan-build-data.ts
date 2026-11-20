import type { SupabaseClient, User } from "@supabase/supabase-js";
import { groupTasksByRoot, isInBacklog, type TaskRow } from "@/lib/asana/task-view";
import { computeStageInfo, videoTypeOf } from "@/lib/asana/stage-context";
import { STAGES } from "@/lib/asana/stage";
import { resolveEstimatesForTasks, type EstimateTarget } from "@/lib/estimates-data";
import { provisionalHours } from "@/lib/estimates";
import { resolvePriority } from "@/lib/priority";
import { isDueThisWeekOrOverdue } from "@/lib/plan";
import { loadSettings } from "@/lib/settings-data";
import { getWeekCapacity } from "@/lib/calendar/week-capacity";
import { subtractOccupied, type Range } from "@/lib/blocks";
import { partitionProtected, type BuildCandidate, type ExistingRow } from "@/lib/plan-build";
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
  user: User,
  weekStart: string,
  options?: { treatAllExistingAsProtected?: boolean }
): Promise<WeekBuildInputs> {
  const timezone = env.appTimezone();
  const todayStr = utcInstantToLocal(new Date(), timezone).dateStr;
  const weekEndExclusive = addDaysToDateStr(weekStart, 7);
  const settings = await loadSettings(supabase, user.id);

  const [tasksResult, personalResult, metaResult, existingResult, weekCapacity] = await Promise.all([
    supabase
      .from("asana_tasks")
      .select(
        "gid, name, parent_gid, parent_name, project_names, section_names, due_on, start_on, completed, custom_fields, permalink_url, assignee_name, is_container, is_plannable, is_shoot, no_longer_assigned, blocked_by_gids"
      )
      .eq("completed", false)
      .eq("no_longer_assigned", false),
    supabase.from("personal_tasks").select("id, name, estimate_hours, priority, due_on").eq("user_id", user.id).eq("completed", false),
    supabase.from("task_meta").select("source, reference, parked, priority_override").eq("user_id", user.id),
    supabase
      .from("plan_items")
      .select("id, source, reference, day, must, status, pinned, start_time, end_time")
      .eq("user_id", user.id)
      .eq("week_start", weekStart),
    getWeekCapacity(supabase, user.id, timezone, settings, weekStart, { useActualStarts: weekStart === mondayOf(todayStr) }),
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
  const existingRows = (existingResult.data ?? []) as ExistingDbRow[];

  const visibleGroups = groupTasksByRoot(allTasks).filter((g) => !isInBacklog(g.root));
  const stageInfoByGroup = visibleGroups.map((g) => computeStageInfo(g));
  const taskByRef = new Map<string, TaskRow>();
  const stageInfoByRef = new Map<string, { stage: string | null; focusType: string }>();
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
  const estimatesByKey = await resolveEstimatesForTasks(supabase, user.id, targets);

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
    const estimate = estimatesByKey.get(key) ?? { hours: null, origin: "none" as const, label: "needs estimate" };
    const provisional = provisionalHours(estimate);
    if (provisional == null) {
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
      dueOn: task.due_on,
      priority: resolvePriority(task.custom_fields["Priority"] ?? null, priorityOverrideByRef.get(gid) ?? null),
      focusType: (focusType as "deep" | "shallow" | "away" | "waiting" | null) ?? "shallow",
      estimateHours: provisional.hours,
      blockedByGids: task.blocked_by_gids ?? [],
      isProvisional: provisional.isProvisional,
    });
  }

  for (const t of eligiblePersonal) {
    const key = `personal:${t.id}`;
    nameByKey.set(key, t.name);
    const estimate =
      t.estimate_hours != null
        ? { hours: t.estimate_hours, origin: "user" as const, label: "your estimate" }
        : { hours: null, origin: "none" as const, label: "needs estimate" };
    const provisional = provisionalHours(estimate);
    if (provisional == null) continue;
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
      estimateHours: provisional.hours,
      blockedByGids: [],
      isProvisional: provisional.isProvisional,
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

  return { candidates, needsEstimatePick, nameByKey, mustByKey, existingRows, protectedKeys, freeBlocksByDay, dayOrder, weekCapacityHours, completedByGid, toRank };
}
