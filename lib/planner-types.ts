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
};

export type EverythingElseGroup = {
  rootRef: string;
  rootName: string;
  projectName: string;
  isContainer: boolean;
  nothingLeftToPlan: boolean;
  tasks: PlannerTask[];
};
