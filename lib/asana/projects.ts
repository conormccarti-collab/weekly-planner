// v1.3 workspace structure (brief section 1). Fixed gids for this workspace.
export const PIPELINE_PROJECT_GID = "1220595755618852";
export const PIPELINE_PROJECT_NAME = "Visual Content Pipeline";
export const PRODUCTION_SHOOTS_PROJECT_GID = "1220595755659253";
export const LONG_FORM_VIDEO_PROJECT_NAME = "Long Form Video";

/**
 * v1.3: "When a task sits in both [Long Form Video and Pipeline], show
 * Visual Content Pipeline as its project" — specifically that pairing
 * (Long Form Video is a legacy/near-duplicate of Pipeline), not a blanket
 * "Pipeline beats any other project" rule. Collapsing on Pipeline's mere
 * presence used to swallow a task's real, unrelated project (e.g. "Black
 * Friday 2026") whenever it also happened to sit in Pipeline — this is the
 * fix for that.
 */
function collapsesToPipeline(projectNames: string[]): boolean {
  return projectNames.includes(PIPELINE_PROJECT_NAME) && projectNames.includes(LONG_FORM_VIDEO_PROJECT_NAME);
}

export function preferredProjectName(projectNames: string[]): string {
  return collapsesToPipeline(projectNames) ? PIPELINE_PROJECT_NAME : projectNames.join(", ");
}

/**
 * v4: every real project a task belongs to, for grouping/counting — never
 * joined into one combined label. `preferredProjectName`'s join is fine as
 * a single-task display string, but used as a *grouping key* it silently
 * invented a third, phantom "project" for any task in two real ones,
 * stealing its count away from both of them (and from a task in no
 * project at all, this returns `[]` — it's never attributed to Pipeline or
 * anywhere else).
 */
export function projectLabelsFor(projectNames: string[]): string[] {
  if (collapsesToPipeline(projectNames)) return [PIPELINE_PROJECT_NAME];
  return projectNames;
}
