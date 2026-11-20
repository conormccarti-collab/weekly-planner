// v1.3: Creative Brief replaces Script; Ideation and Script are legacy
// names that now map to it. Revisions, Shorts and Archive are new.
export const STAGES = [
  "Creative Brief",
  "Planning & Pre-Production",
  "Shoot",
  "Pre-Edit Review & Brief",
  "Edit",
  "Review",
  "Revisions",
  "Shorts",
  "Publish",
  "Archive",
] as const;

export type Stage = (typeof STAGES)[number];
export type FocusType = "shallow" | "deep" | "away" | "waiting";

/** Legacy subtask names that fuzzy-match to a current stage instead of their own. */
const STAGE_ALIASES: Record<string, Stage> = {
  Ideation: "Creative Brief",
  Script: "Creative Brief",
};

/** v1.3's stage table. Review's focus depends on context — see resolveReviewFocus. */
export const STAGE_FOCUS: Record<Stage, FocusType> = {
  "Creative Brief": "shallow",
  "Planning & Pre-Production": "shallow",
  Shoot: "away",
  "Pre-Edit Review & Brief": "deep",
  Edit: "deep",
  Review: "waiting",
  Revisions: "deep",
  Shorts: "shallow",
  Publish: "shallow",
  Archive: "shallow",
};

function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

type Candidate = { name: string; stage: Stage };

const CANDIDATES: Candidate[] = [
  ...STAGES.map((stage) => ({ name: stage, stage })),
  ...Object.entries(STAGE_ALIASES).map(([name, stage]) => ({ name, stage })),
];

/**
 * v1.3: "A stage is detected from the subtask name, ignoring case, spacing
 * and small spelling differences" — e.g. "Planning &Pre-Production",
 * "Planning & Pre Production", "Pre-Edit Revire & Brief" and "Pre-edit
 * Review & Brief" must all be recognised, and legacy "Ideation"/"Script"
 * subtasks map to Creative Brief. A task with no recognised stage is a
 * plain task (focus type shallow).
 */
export function detectStage(taskName: string): Stage | null {
  const normalizedName = normalize(taskName);

  // Shoot tasks carry a suffix ("Shoot 1 - England", "Shoot: Mill",
  // "Shoot 2 - Mill") that a whole-string fuzzy match would never recognise
  // as close to the bare word "Shoot" — a prefix match handles both the
  // bare case and every suffixed variant in the real data.
  if (normalizedName === "shoot" || normalizedName.startsWith("shoot ")) {
    return "Shoot";
  }

  let best: { stage: Stage; distance: number } | null = null;

  for (const candidate of CANDIDATES) {
    const normalizedCandidate = normalize(candidate.name);
    const distance = levenshtein(normalizedName, normalizedCandidate);
    const threshold = Math.max(2, Math.ceil(normalizedCandidate.length * 0.15));
    if (distance <= threshold && (!best || distance < best.distance)) {
      best = { stage: candidate.stage, distance };
    }
  }

  return best ? best.stage : null;
}

/**
 * v2 (18 Nov 2026): the 48-hour wait is dropped — nothing enforced it, and
 * Review is now just a marker of who owns the edit. When the user is the
 * Edit assignee on this deliverable, their own Review is a 0-hour marker
 * (focus type "waiting", no desk hours, no timer). When they're reviewing
 * someone else's edit, it's a short shallow task.
 */
export function resolveReviewFocus(userIsEditorOnThisDeliverable: boolean): FocusType {
  return userIsEditorOnThisDeliverable ? "waiting" : "shallow";
}
