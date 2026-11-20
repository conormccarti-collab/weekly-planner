import type { TaskGroup } from "@/lib/asana/task-view";
import type { StageInfo } from "@/lib/asana/stage-context";
import type { EstimateResult } from "@/lib/estimates";
import { isCountedInTotals } from "@/lib/estimates";
import { computeLatestStarts, type BackSchedulingResult, type BackSchedulingStage } from "@/lib/back-scheduling";
import { weekdayOfDateStr, type Weekday } from "@/lib/time";

/**
 * v4 Stage 4b: a flat capacity model (hours/day on a working weekday, 0
 * otherwise) rather than full real-calendar integration — back-scheduling
 * is explicitly "proposals and warnings only," and the capacity-per-day
 * answer only needs to be a reasonable guide, not an exact placement. The
 * engine itself (`computeLatestStarts`) is capacity-source-agnostic and
 * unit-tested against real zero-capacity (leave) days — only this flat
 * supplier is a deliberate simplification, documented here rather than
 * integrating full calendar lookahead into the core build path.
 */
export function flatCapacityForDate(workingDays: Weekday[], hoursPerDay: number): (dateStr: string) => number {
  return (dateStr: string) => (workingDays.includes(weekdayOfDateStr(dateStr)) ? hoursPerDay : 0);
}

/**
 * Brief 7.4b.1-2: "Take the stages the user does, in template order, from
 * the user's plannable subtasks... work backwards from the publish date."
 * Returns null when the deliverable has no publish date at all (brief:
 * this only applies to "each deliverable with a publish date on its
 * parent").
 */
export function computeDeliverableLatestStarts(
  group: TaskGroup,
  stageInfoByRef: Map<string, StageInfo>,
  estimatesByKey: Map<string, EstimateResult>,
  capacityHoursForDate: (dateStr: string) => number
): BackSchedulingResult | null {
  const publishDate = group.root.due_on;
  if (!publishDate) return null;

  const stages: BackSchedulingStage[] = [];
  for (const task of group.descendants) {
    if (!task.is_plannable) continue;
    const info = stageInfoByRef.get(task.gid);
    if (!info?.stage) continue;
    const estimate = estimatesByKey.get(`asana:${task.gid}`);
    stages.push({
      gid: task.gid,
      stage: info.stage,
      confirmedHours: estimate && isCountedInTotals(estimate.origin) ? estimate.hours : null,
      ownDueOn: task.due_on,
    });
  }
  if (stages.length === 0) return null;

  return computeLatestStarts(publishDate, stages, capacityHoursForDate);
}
