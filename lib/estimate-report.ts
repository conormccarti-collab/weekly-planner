import type { Stage } from "@/lib/asana/stage";

export type ReportInputRow = {
  videoType: string | null;
  stage: Stage | null;
  hours: number;
  actualHours: number | null;
  status: string;
};

export type EstimateReportRow = {
  videoType: string;
  stage: Stage;
  plannedHours: number;
  /** Sum of actual_hours from blocks marked Done only. */
  actualHours: number;
  /** Count of Done blocks — also the gate for `suggestedDefault`. */
  doneBlockCount: number;
  /** actual - planned: positive means it ran over. */
  difference: number;
  /** Average actual hours per Done block — only set once `doneBlockCount >= 3` (brief 9.3: "only where there are at least three completed blocks"). */
  suggestedDefault: number | null;
};

/**
 * Brief section 9, the estimate report: "For each Video Type and stage show
 * planned hours, actual hours from blocks marked Done, the number of
 * blocks, and the difference." Pure — the caller filters rows to whatever
 * period was selected and resolves each block's Video Type/stage first.
 * A row with no Video Type or no detected stage can't be grouped, so it's
 * left out rather than lumped under "Unknown".
 */
export function computeEstimateReport(rows: ReportInputRow[]): EstimateReportRow[] {
  const groups = new Map<string, { videoType: string; stage: Stage; plannedHours: number; actualHours: number; doneBlockCount: number }>();

  for (const row of rows) {
    if (row.videoType == null || row.stage == null) continue;
    const key = `${row.videoType}:${row.stage}`;
    const group = groups.get(key) ?? { videoType: row.videoType, stage: row.stage, plannedHours: 0, actualHours: 0, doneBlockCount: 0 };
    group.plannedHours += row.hours;
    if (row.status === "done" && row.actualHours != null) {
      group.actualHours += row.actualHours;
      group.doneBlockCount += 1;
    }
    groups.set(key, group);
  }

  return [...groups.values()]
    .map((g) => ({
      videoType: g.videoType,
      stage: g.stage,
      plannedHours: g.plannedHours,
      actualHours: g.actualHours,
      doneBlockCount: g.doneBlockCount,
      difference: g.actualHours - g.plannedHours,
      suggestedDefault: g.doneBlockCount >= 3 ? g.actualHours / g.doneBlockCount : null,
    }))
    .sort((a, b) => a.videoType.localeCompare(b.videoType) || a.stage.localeCompare(b.stage));
}

/** Brief section 9: "Export as CSV." */
export function estimateReportToCsv(rows: EstimateReportRow[]): string {
  const header = "Video Type,Stage,Planned Hours,Actual Hours,Done Blocks,Difference,Suggested Default";
  const lines = rows.map((r) =>
    [r.videoType, r.stage, r.plannedHours.toFixed(2), r.actualHours.toFixed(2), r.doneBlockCount, r.difference.toFixed(2), r.suggestedDefault?.toFixed(2) ?? ""]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(",")
  );
  return [header, ...lines].join("\n");
}
