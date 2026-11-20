import type { TaskRow } from "@/lib/asana/task-view";
import type { StageInfo } from "@/lib/asana/stage-context";
import { videoTypeOf } from "@/lib/asana/stage-context";
import { preferredProjectName } from "@/lib/asana/projects";
import type { EstimateResult } from "@/lib/estimates";
import { resolvePriority } from "@/lib/priority";
import type { Placement, PlannerTask } from "@/lib/planner-types";

export const FOCUS_LABEL: Record<string, string> = {
  shallow: "shallow",
  deep: "deep",
  away: "away from desk",
  waiting: "waiting on others",
};

function estimateDisplay(estimate: EstimateResult, videoType: string | null, fixedZeroHours: boolean): string {
  if (fixedZeroHours) return "0h";
  if (estimate.hours != null) {
    return estimate.origin === "user" ? `${estimate.hours}h` : `${estimate.hours}h (${estimate.label})`;
  }
  return videoType == null ? "needs Video Type" : "needs estimate";
}

export type PersonalTaskRow = {
  id: string;
  name: string;
  estimate_hours: number | null;
  priority: string | null;
  due_on: string | null;
};

export function toPersonalPlannerTask(task: PersonalTaskRow, must: boolean, placements: Placement[]): PlannerTask {
  return {
    source: "personal",
    reference: task.id,
    rootRef: task.id,
    name: task.name,
    parentName: null,
    projectName: "Personal",
    dueOn: task.due_on,
    rootDueOn: task.due_on,
    priority: task.priority,
    stage: null,
    focusType: null,
    focusLabel: null,
    videoType: null,
    brand: null,
    fixedZeroHours: false,
    estimateHours: task.estimate_hours,
    estimateDisplay: task.estimate_hours != null ? `${task.estimate_hours}h` : "needs estimate",
    must,
    placements,
    isBlocked: false,
  };
}

export function toPlannerTask(
  task: TaskRow,
  stageInfo: StageInfo | undefined,
  estimate: EstimateResult | undefined,
  must: boolean,
  placements: Placement[],
  priorityOverride: string | null = null,
  rootRef: string = task.gid,
  rootDueOn: string | null = task.due_on,
  isBlocked: boolean = false
): PlannerTask {
  const focusType = stageInfo?.focusType ?? null;
  const fixedZeroHours = focusType === "away" || focusType === "waiting";
  const est = estimate ?? { hours: null, origin: "none" as const, label: "needs estimate" };

  return {
    source: "asana",
    reference: task.gid,
    rootRef,
    name: task.name,
    parentName: task.parent_name,
    projectName: preferredProjectName(task.project_names),
    dueOn: task.due_on,
    rootDueOn,
    priority: resolvePriority(task.custom_fields["Priority"] ?? null, priorityOverride),
    stage: stageInfo?.stage ?? null,
    focusType,
    focusLabel: focusType ? FOCUS_LABEL[focusType] : null,
    videoType: videoTypeOf(task),
    brand: task.custom_fields["Brand"] ?? null,
    fixedZeroHours,
    estimateHours: fixedZeroHours ? 0 : est.hours,
    estimateDisplay: estimateDisplay(est, videoTypeOf(task), fixedZeroHours),
    estimateAmbiguousOptions: fixedZeroHours ? undefined : est.ambiguousOptions,
    must,
    placements,
    isBlocked,
  };
}
