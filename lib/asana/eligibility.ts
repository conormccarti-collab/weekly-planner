import type { TaskGroup } from "./task-view";

/**
 * v5 Stage 12d: "Plan only: tasks and subtasks in Visual Content Pipeline
 * whose parent is not completed, tasks in Production & Shoots, and personal
 * tasks... Everything else assigned to Conor appears in a collapsed
 * 'Outside the workflow' list, is never placed, never counted as At risk,
 * and never flagged by Hygiene."
 *
 * A group's root having a non-null `parent_gid` means it's an orphaned
 * subtask whose real parent was excluded from the fetch (completed, or
 * never synced) — not a genuine deliverable at all, regardless of project.
 * This is the same tell `isGenuinePipelineDeliverable` (lib/hygiene.ts)
 * already used for Hygiene alone; applied globally here.
 */
export function isPlannableGroup(group: TaskGroup, plannedProjectGids: string[]): boolean {
  if (group.root.parent_gid != null) return false;
  return group.root.project_gids.some((gid) => plannedProjectGids.includes(gid));
}

export function partitionByEligibility<G extends TaskGroup>(
  groups: G[],
  plannedProjectGids: string[]
): { eligible: G[]; outsideWorkflow: G[] } {
  const eligible: G[] = [];
  const outsideWorkflow: G[] = [];
  for (const group of groups) {
    (isPlannableGroup(group, plannedProjectGids) ? eligible : outsideWorkflow).push(group);
  }
  return { eligible, outsideWorkflow };
}
