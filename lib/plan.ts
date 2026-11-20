/**
 * Brief section 8: "A task is in 'this week' if it is due this week or
 * overdue, was left unfinished in last week's saved plan, is flagged Must,
 * or was pulled in by the user." The last three are persisted as plan_items
 * rows (handled by the data layer) — this just covers the due-date check.
 */
export function isDueThisWeekOrOverdue(dueOn: string | null, weekEndExclusive: string): boolean {
  if (!dueOn) return false;
  return dueOn < weekEndExclusive;
}

export type DayTotals = {
  plannedHours: number;
  capacityHours: number;
  overCapacity: boolean;
};

export function computeDayTotals(placedHours: number[], capacityHours: number): DayTotals {
  const plannedHours = placedHours.reduce((sum, h) => sum + h, 0);
  return { plannedHours, capacityHours, overCapacity: plannedHours > capacityHours };
}

export type WeekTotals = DayTotals;

export function computeWeekTotals(dayTotals: DayTotals[]): WeekTotals {
  const plannedHours = dayTotals.reduce((sum, d) => sum + d.plannedHours, 0);
  const capacityHours = dayTotals.reduce((sum, d) => sum + d.capacityHours, 0);
  return { plannedHours, capacityHours, overCapacity: plannedHours > capacityHours };
}

export type StageBreakdownRow = { stage: string; plannedHours: number; actualHours: number };

/** The record keeper: planned vs. actual hours, grouped by stage. */
export function computeStageBreakdown(
  tasks: { stage: string | null; placements: { hours: number; actualHours: number | null; status: string }[] }[]
): StageBreakdownRow[] {
  const byStage = new Map<string, StageBreakdownRow>();

  for (const task of tasks) {
    const stage = task.stage ?? "Other";
    const row = byStage.get(stage) ?? { stage, plannedHours: 0, actualHours: 0 };
    for (const placement of task.placements) {
      row.plannedHours += placement.hours;
      if (placement.status === "done" && placement.actualHours != null) {
        row.actualHours += placement.actualHours;
      }
    }
    byStage.set(stage, row);
  }

  return [...byStage.values()]
    .filter((row) => row.plannedHours > 0 || row.actualHours > 0)
    .sort((a, b) => b.plannedHours - a.plannedHours);
}
