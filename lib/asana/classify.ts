/**
 * Brief section 5, "Parents and subtasks":
 * - A container (has subtasks) is never planned or estimated itself.
 * - An unassigned subtask under a container the user owns is the user's work.
 * - A subtask assigned to someone else is shown for context, never planned.
 * - A subtask assigned to the user is planned as normal.
 *
 * v2 change (18 Nov 2026): Review is a marker of who owns the edit, not
 * ordinary work — the general "unassigned counts as mine" rule doesn't
 * apply to it. A Review is plannable only when it's assigned to the user
 * by name; unassigned or assigned elsewhere, it's context-only.
 */
export function classifyTask(
  numSubtasks: number,
  assigneeGid: string | null,
  meGid: string,
  stage: string | null = null
): { isContainer: boolean; isPlannable: boolean } {
  const isContainer = numSubtasks > 0;
  const isPlannable = isContainer
    ? false
    : stage === "Review"
      ? assigneeGid === meGid
      : assigneeGid === null || assigneeGid === meGid;
  return { isContainer, isPlannable };
}
