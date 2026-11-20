import { detectStage, STAGES, type Stage } from "@/lib/asana/stage";
import { videoTypeOf } from "@/lib/asana/stage-context";
import { PIPELINE_PROJECT_NAME } from "@/lib/asana/projects";
import type { TaskGroup, TaskRow } from "@/lib/asana/task-view";

/**
 * v4: "ignore tasks with a completed or unsynced parent, restrict to Visual
 * Content Pipeline." `groupTasksByRoot` can only walk up to a real parent
 * that was itself fetched — when a subtask's parent is completed (excluded
 * by the sync query's own filter) or was never synced at all, that subtask
 * becomes its own "root" by default. Checking it as if it were a genuine
 * deliverable is exactly the noise this excludes: a non-null `parent_gid`
 * on the root is the tell, since a real root never has one.
 */
export function isGenuinePipelineDeliverable(group: TaskGroup): boolean {
  return group.root.parent_gid == null && group.root.project_names.includes(PIPELINE_PROJECT_NAME);
}

export type HygieneFlag = {
  gid: string;
  name: string;
  permalinkUrl: string | null;
  issue: string;
};

/** v2 (18 Nov 2026), item B.7: the nine valid Video Type values, confirmed by the user. */
export const KNOWN_VIDEO_TYPES = [
  "Youtube Narrative",
  "Youtube Discovery",
  "Website",
  "Paid",
  "Trade",
  "WPT",
  "Internal",
  "Photography",
  "Special Projects",
] as const;

function isKnownVideoType(value: string): boolean {
  return KNOWN_VIDEO_TYPES.some((known) => known.toLowerCase() === value.trim().toLowerCase());
}

function flag(task: Pick<TaskRow, "gid" | "name" | "permalink_url">, issue: string): HygieneFlag {
  return { gid: task.gid, name: task.name, permalinkUrl: task.permalink_url, issue };
}

/** Video Type blank, or not one of the nine known values — after the same trim/synonym normalization `videoTypeOf` applies everywhere else. */
export function checkVideoType(task: TaskRow): HygieneFlag[] {
  const videoType = videoTypeOf(task);
  if (videoType == null) return [flag(task, "Video Type is blank")];
  if (!isKnownVideoType(videoType)) return [flag(task, `Video Type "${videoType}" isn't one of the nine known values`)];
  return [];
}

/** Brand blank. Brand is also read for calendar block colour — see `brandColorsFor` in `components/calendar-grid.tsx`. */
export function checkBrand(task: TaskRow): HygieneFlag[] {
  if (task.custom_fields["Brand"] == null) return [flag(task, "Brand is blank")];
  return [];
}

/** A subtask whose name matches no stage. */
export function checkUnmatchedStage(task: TaskRow): HygieneFlag[] {
  if (detectStage(task.name) == null) return [flag(task, "Name doesn't match any known stage")];
  return [];
}

/** v4 Stage 4a, brief 7.4a: "An unmatched [shoot] gets a Hygiene flag, 'Shoot not in calendar'." Caller supplies the match result — this file has no calendar access of its own. */
export function checkShootInCalendar(task: TaskRow, matched: boolean): HygieneFlag[] {
  if (!matched) return [flag(task, "Shoot not in calendar")];
  return [];
}

/**
 * Group-level date checks: missing publish date on the parent, missing due
 * date on the Edit subtask, missing shoot date on a shoot task. v2 (18 Nov
 * 2026): every issue is attributed to the parent deliverable, even when the
 * underlying gap is on a subtask — hygiene only ever lists parent cards.
 */
export function checkGroupDates(group: TaskGroup): HygieneFlag[] {
  const flags: HygieneFlag[] = [];
  const members = [group.root, ...group.descendants].filter((t) => !t.is_container);
  const isDeliverable = members.some((t) => detectStage(t.name) != null);

  if (isDeliverable && group.root.due_on == null) {
    flags.push(flag(group.root, "Missing publish date on the parent"));
  }

  const editTask = members.find((t) => detectStage(t.name) === "Edit");
  if (editTask && editTask.due_on == null) {
    flags.push(flag(group.root, "Missing due date on the Edit subtask"));
  }

  for (const task of members) {
    if (task.is_shoot && task.due_on == null && task.start_on == null) {
      flags.push(flag(group.root, `Missing shoot date (${task.name})`));
    }
  }

  return flags;
}

/**
 * v2 (18 Nov 2026): the Asana board column a deliverable should sit in,
 * given the earliest stage among its subtasks that isn't done yet (a
 * finished stage's subtask is completed, so it's already absent from the
 * non-completed set every caller here works from).
 */
const STAGE_TO_COLUMN: Record<Stage, string> = {
  "Creative Brief": "Pre-Production",
  "Planning & Pre-Production": "Pre-Production",
  Shoot: "Shoot",
  "Pre-Edit Review & Brief": "Edit",
  Edit: "Edit",
  Review: "Review",
  Revisions: "Review",
  Shorts: "Publish / Deliver",
  Publish: "Publish / Deliver",
  Archive: "Publish / Deliver",
};

/** No subtask for any known stage is still open — the deliverable hasn't been commissioned yet. */
const NOT_COMMISSIONED_COLUMN = "Backlog";

function normalizeColumnName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function earliestUnfinishedStage(members: TaskRow[]): Stage | null {
  for (const stage of STAGES) {
    if (members.some((t) => !t.is_container && detectStage(t.name) === stage)) return stage;
  }
  return null;
}

/** Flags a deliverable sitting in a column that doesn't match its earliest unfinished stage. */
export function checkColumnMatchesStage(group: TaskGroup): HygieneFlag[] {
  const members = [group.root, ...group.descendants].filter((t) => !t.is_container);
  const stage = earliestUnfinishedStage(members);
  const expectedColumn = stage ? STAGE_TO_COLUMN[stage] : NOT_COMMISSIONED_COLUMN;

  const actualColumns = group.root.section_names ?? [];
  const inExpectedColumn = actualColumns.some((c) => normalizeColumnName(c) === normalizeColumnName(expectedColumn));
  if (inExpectedColumn) return [];

  const actual = actualColumns.length > 0 ? actualColumns.join(", ") : "no column";
  const stageLabel = stage ?? "not commissioned";
  return [flag(group.root, `In "${actual}" but its earliest unfinished stage (${stageLabel}) belongs in "${expectedColumn}"`)];
}
