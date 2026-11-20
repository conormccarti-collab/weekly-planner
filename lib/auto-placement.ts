/**
 * Release 1.1, brief section 10: "Order tasks by: Must, then hard deadline,
 * then priority (override before Asana), then due date. Deep work goes
 * into the longest free blocks first. Shorter tasks fill the gaps. Deep
 * work may use a gap of one hour or more only when no shallow task is
 * left, and never a gap under one hour. Stages of the same deliverable
 * keep their order. Shown as a proposal."
 *
 * This only proposes placements — nothing is written until the user
 * approves (brief rule 4: changes are proposed, then approved).
 *
 * v2 (18 Nov 2026): "hard deadline" redefined from "the task has any due
 * date" to "the parent deliverable has a publish date, or the task is
 * flagged Must" — a stage subtask's own internal due date no longer counts
 * on its own.
 */

export type FocusType = "deep" | "shallow" | "away" | "waiting";

export type AutoPlaceCandidate = {
  source: "asana" | "personal";
  reference: string;
  /** Groups stage-subtasks of the same deliverable; use the task's own reference when there's no grouping concept. */
  rootRef: string;
  /** The task's position within its deliverable's stage pipeline (e.g. Edit before Review). Ties within a group are broken by this, never by priority/due date. */
  stageOrder: number;
  must: boolean;
  /** v2 (18 Nov 2026): a publish date on the parent deliverable, or a Must flag — not just any due date on the task itself. */
  hasHardDeadline: boolean;
  /** v4 Stage 4b, brief 7.4.8: the back-scheduled latest start for this task's stage, or null/undefined when none was computable (no publish date, no estimate, etc.) — sorts after every computed date. */
  latestStartDate?: string | null;
  dueOn: string | null;
  /** Already resolved: override beats Asana (brief section 9). */
  priority: string | null;
  focusType: FocusType;
  estimateHours: number;
};

export type FreeBlock = { startMinutes: number; endMinutes: number };

export type ProposedPlacement = {
  source: "asana" | "personal";
  reference: string;
  day: string;
  startMinutes: number;
  endMinutes: number;
};

export type UnplacedCandidate = { source: "asana" | "personal"; reference: string; reason: string };

export type AutoPlacementResult = {
  placements: ProposedPlacement[];
  unplaced: UnplacedCandidate[];
};

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

function priorityRank(priority: string | null): number {
  if (priority == null) return 3;
  return PRIORITY_RANK[priority.toLowerCase()] ?? 3;
}

/**
 * The five-tier sort key (brief 7.4.8: "Must, hard deadline, latest start,
 * priority, due date" — the latest-start tier sits between hard deadline
 * and priority), with "stages of the same deliverable keep their order"
 * layered on top: a deliverable's tasks are kept together in stage-pipeline
 * order, at the position its best-ranked member earns.
 */
export function orderCandidatesForPlacement(candidates: AutoPlaceCandidate[]): AutoPlaceCandidate[] {
  const sorted = [...candidates].sort((a, b) => {
    if (a.must !== b.must) return a.must ? -1 : 1;
    if (a.hasHardDeadline !== b.hasHardDeadline) return a.hasHardDeadline ? -1 : 1;
    const latestStartDiff = (a.latestStartDate ?? "9999-99-99").localeCompare(b.latestStartDate ?? "9999-99-99");
    if (latestStartDiff !== 0) return latestStartDiff;
    const priorityDiff = priorityRank(a.priority) - priorityRank(b.priority);
    if (priorityDiff !== 0) return priorityDiff;
    return (a.dueOn ?? "9999-99-99").localeCompare(b.dueOn ?? "9999-99-99");
  });

  const groupOrder: string[] = [];
  const groups = new Map<string, AutoPlaceCandidate[]>();
  for (const candidate of sorted) {
    if (!groups.has(candidate.rootRef)) {
      groupOrder.push(candidate.rootRef);
      groups.set(candidate.rootRef, []);
    }
    groups.get(candidate.rootRef)!.push(candidate);
  }

  return groupOrder.flatMap((rootRef) => [...groups.get(rootRef)!].sort((a, b) => a.stageOrder - b.stageOrder));
}

function snapTo15(minutes: number): number {
  return Math.max(15, Math.round(minutes / 15) * 15);
}

function lengthOf(block: FreeBlock): number {
  return block.endMinutes - block.startMinutes;
}

/**
 * Deep work gets the longest fitting block; shallow work gets the
 * smallest fitting block (the natural complement — leaving the big blocks
 * free for the next deep task). A 60-74 minute gap is treated as "right at
 * the threshold" and reserved for shallow work unless none is left; deep
 * work never takes anything under 60 minutes at all. This exact cutoff
 * isn't given a number in the brief — it's a judgement call, safe to
 * revisit since nothing here is applied until the user approves it.
 */
const DEEP_RESERVE_THRESHOLD_MINUTES = 75;

export function proposeAutoPlacement(
  orderedCandidates: AutoPlaceCandidate[],
  freeBlocksByDay: Map<string, FreeBlock[]>,
  dayOrder: string[]
): AutoPlacementResult {
  const blocks: (FreeBlock & { day: string })[] = dayOrder.flatMap((day) =>
    (freeBlocksByDay.get(day) ?? []).map((b) => ({ ...b, day }))
  );

  let shallowRemaining = orderedCandidates.filter((c) => c.focusType === "shallow").length;
  const placements: ProposedPlacement[] = [];
  const unplaced: UnplacedCandidate[] = [];

  for (const candidate of orderedCandidates) {
    if (candidate.focusType === "shallow") shallowRemaining--;
    if (candidate.focusType === "away" || candidate.focusType === "waiting") continue; // fixed 0h, nothing to place

    const duration = snapTo15(candidate.estimateHours * 60);

    let fitting = blocks.filter((b) => lengthOf(b) >= duration);
    if (candidate.focusType === "deep") {
      fitting = fitting.filter((b) => lengthOf(b) >= 60);
      if (shallowRemaining > 0) {
        fitting = fitting.filter((b) => lengthOf(b) >= DEEP_RESERVE_THRESHOLD_MINUTES);
      }
    }

    if (fitting.length === 0) {
      unplaced.push({ source: candidate.source, reference: candidate.reference, reason: "No suitable free block this week" });
      continue;
    }

    const chosen =
      candidate.focusType === "deep"
        ? fitting.reduce((longest, b) => (lengthOf(b) > lengthOf(longest) ? b : longest))
        : fitting.reduce((smallest, b) => (lengthOf(b) < lengthOf(smallest) ? b : smallest));

    const startMinutes = chosen.startMinutes;
    const endMinutes = startMinutes + duration;
    placements.push({ source: candidate.source, reference: candidate.reference, day: chosen.day, startMinutes, endMinutes });

    const index = blocks.indexOf(chosen);
    if (endMinutes < chosen.endMinutes) {
      blocks[index] = { ...chosen, startMinutes: endMinutes };
    } else {
      blocks.splice(index, 1);
    }
  }

  return { placements, unplaced };
}
