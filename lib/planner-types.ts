export type PlannerTask = {
  source: "asana" | "personal";
  reference: string;
  /** The deliverable this task belongs to — its group's root gid for Asana, itself for personal tasks. */
  rootRef: string;
  name: string;
  parentName: string | null;
  projectName: string;
  dueOn: string | null;
  /** The deliverable's own publish date (its root task's due date) — distinct from this task's own due date. */
  rootDueOn: string | null;
  priority: string | null;
  stage: string | null;
  focusType: string | null;
  focusLabel: string | null;
  videoType: string | null;
  brand: string | null;
  fixedZeroHours: boolean;
  estimateHours: number | null;
  estimateDisplay: string;
  estimateAmbiguousOptions?: { variant: string; hours: number }[];
  must: boolean;
  placements: Placement[];
  /** v4 Stage 3, brief 6.2: a manually-placed block whose task is still waiting on an unfinished blocker shows a warning on the block. */
  isBlocked: boolean;
  /** v5 Stage 13a: why the build couldn't place this task, when it has no placements — null when placed, or when the stored reason predates migration 0030. */
  unplacedReason: string | null;
};

export type Placement = {
  id: string;
  day: string;
  startMinutes: number;
  endMinutes: number;
  hours: number;
  actualHours: number | null;
  status: string;
  isFinal: boolean;
  pinned: boolean;
  /** v5 Stage 12g §B: set only when this task has more than one placed block this week — "Part 2 of 5". */
  partIndex?: number;
  partCount?: number;
  /** v5 Stage 13a: a work-ahead-fill placement — pulled forward into spare capacity before it was actually due. */
  isAhead: boolean;
  /** v5 Stage 18a: when the "Start" button was clicked — null until then. */
  startedAt: string | null;
};

export type EverythingElseGroup = {
  rootRef: string;
  rootName: string;
  projectName: string;
  isContainer: boolean;
  nothingLeftToPlan: boolean;
  tasks: PlannerTask[];
  /** v4 Stage 5, brief 8/3.3: shared series name for a Discovery batch/episode ("Series: Batch 1", "Series: Ep 3"), or null for an ordinary deliverable. */
  seriesName: string | null;
};
