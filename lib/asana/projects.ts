// v1.3 workspace structure (brief section 1). Fixed gids for this workspace.
export const PIPELINE_PROJECT_GID = "1220595755618852";
export const PIPELINE_PROJECT_NAME = "Visual Content Pipeline";
export const PRODUCTION_SHOOTS_PROJECT_GID = "1220595755659253";

/** v1.3: "When a task sits in both [Long Form Video and Pipeline], show Visual Content Pipeline as its project." */
export function preferredProjectName(projectNames: string[]): string {
  return projectNames.includes(PIPELINE_PROJECT_NAME) ? PIPELINE_PROJECT_NAME : projectNames.join(", ");
}
