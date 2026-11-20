import { detectStage, resolveReviewFocus, STAGE_FOCUS, type FocusType, type Stage } from "./stage";
import type { TaskGroup, TaskRow } from "./task-view";

export type StageInfo = { stage: Stage | null; focusType: FocusType };

/**
 * Per-task stage and focus type for every non-container task in a group.
 * Review needs sibling context (brief section 5): if this deliverable's
 * Edit subtask is the user's own work, their Review is a 0-hour marker with
 * no desk hours (v2, 18 Nov 2026: no wait timer — nothing enforced one);
 * otherwise, if the Review task itself is the user's work, it's a short
 * shallow task (reviewing someone else's edit).
 */
export function computeStageInfo(group: TaskGroup): Map<string, StageInfo> {
  const result = new Map<string, StageInfo>();
  const members = [group.root, ...group.descendants].filter((t) => !t.is_container);

  const editTask = members.find((t) => detectStage(t.name) === "Edit");
  const userIsEditor = !!editTask?.is_plannable;

  for (const task of members) {
    const stage = detectStage(task.name);
    if (!stage) {
      result.set(task.gid, { stage: null, focusType: "shallow" });
      continue;
    }
    const focusType = stage === "Review" ? resolveReviewFocus(userIsEditor) : STAGE_FOCUS[stage];
    result.set(task.gid, { stage, focusType });
  }

  return result;
}

/** v1.3 renamed "Content Type" to "Video Type" everywhere (brief section 2). */
export function videoTypeOf(task: TaskRow): string | null {
  return task.custom_fields["Video Type"] ?? null;
}
