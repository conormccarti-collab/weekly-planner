import { STAGES, type Stage } from "@/lib/asana/stage";
import { addDaysToDateStr } from "@/lib/time";

export type BackSchedulingStage = {
  gid: string;
  stage: Stage;
  /** Confirmed estimate only — brief 7.4.5: "a suggested estimate does not count." Null means no confirmed figure exists. */
  confirmedHours: number | null;
  /** The subtask's own due date, if set — brief 7.4.3: used as that stage's deadline. */
  ownDueOn: string | null;
};

export type LatestStart = {
  gid: string;
  stage: Stage;
  /** Null when `cantCompute` is true. */
  latestStartDate: string | null;
  /** The deadline this stage's latest start was computed against (its own due date, or the stage after it). */
  deadline: string;
};

export type BackSchedulingResult =
  | { ok: true; starts: LatestStart[]; editDueDateWarning: string | null }
  | { ok: false; reason: string };

const STAGE_ORDER = new Map(STAGES.map((s, i) => [s, i]));

/**
 * Brief section 7.4b: work backwards from the publish date through working
 * days and capacity to find the latest start of each stage. Pure — the
 * caller supplies real daily capacity (so leave/zero-capacity days are
 * correctly skipped, same as a weekend) via `capacityHoursForDate`, since
 * fetching an open-ended range of calendar data isn't this function's job.
 */
export function computeLatestStarts(
  publishDate: string,
  stages: BackSchedulingStage[],
  capacityHoursForDate: (dateStr: string) => number,
  maxLookbackDays = 365
): BackSchedulingResult {
  if (stages.some((s) => s.confirmedHours == null)) {
    return { ok: false, reason: "can't compute: needs estimate" };
  }

  const ordered = [...stages]
    .filter((s) => s.stage !== "Archive")
    .sort((a, b) => (STAGE_ORDER.get(a.stage) ?? 0) - (STAGE_ORDER.get(b.stage) ?? 0));

  function walkBack(fromDeadline: string, hoursNeeded: number): string | null {
    if (hoursNeeded <= 0) return fromDeadline;
    let hoursRemaining = hoursNeeded;
    let cursor = fromDeadline;
    let result = fromDeadline;
    let daysWalked = 0;
    // Consume whole days backward from the deadline (inclusive) until the
    // stage's hours are covered — a day with 0 capacity (weekend or leave)
    // is skipped exactly like any other zero-capacity day.
    while (hoursRemaining > 0) {
      const dayCapacity = capacityHoursForDate(cursor);
      if (dayCapacity > 0) {
        hoursRemaining -= dayCapacity;
        result = cursor;
      }
      if (hoursRemaining <= 0) break;
      cursor = addDaysToDateStr(cursor, -1);
      daysWalked++;
      if (daysWalked > maxLookbackDays) return null;
    }
    return result;
  }

  const starts: LatestStart[] = [];
  // The deadline a stage would need if nothing overrode it with its own due
  // date — tracked separately so "the Edit due date is later than needed"
  // can compare against what the chain actually requires, not against
  // Edit's own (possibly overriding) deadline.
  let requiredCursor = publishDate;
  let cursorDeadline = publishDate;
  let editDueDateWarning: string | null = null;

  for (let i = ordered.length - 1; i >= 0; i--) {
    const stage = ordered[i];
    const requiredDeadline = requiredCursor;
    const deadline = stage.ownDueOn ?? cursorDeadline;
    const hoursNeeded = stage.confirmedHours ?? 0;

    const latestStartDate = walkBack(deadline, hoursNeeded);
    const requiredLatestStart = walkBack(requiredDeadline, hoursNeeded);
    if (latestStartDate == null || requiredLatestStart == null) {
      return { ok: false, reason: "can't compute: no capacity found within a year before the publish date" };
    }

    starts.push({ gid: stage.gid, stage: stage.stage, latestStartDate, deadline });
    // The next (earlier) stage's work must finish by the day before this
    // one begins — this stage's latest-start day is spoken for.
    cursorDeadline = addDaysToDateStr(latestStartDate, -1);
    requiredCursor = addDaysToDateStr(requiredLatestStart, -1);

    if (stage.stage === "Edit" && stage.ownDueOn && stage.ownDueOn > requiredLatestStart) {
      editDueDateWarning = `The Edit due date (${stage.ownDueOn}) is later than needed to meet the publish date — it should be ${requiredLatestStart} or earlier.`;
    }
  }

  starts.reverse();

  return { ok: true, starts, editDueDateWarning };
}
