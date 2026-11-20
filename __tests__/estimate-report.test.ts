import { describe, expect, it } from "vitest";
import { computeEstimateReport, estimateReportToCsv, type ReportInputRow } from "@/lib/estimate-report";

function row(overrides: Partial<ReportInputRow> & { hours: number }): ReportInputRow {
  return { videoType: "Youtube Narrative", stage: "Edit", actualHours: null, status: "planned", ...overrides };
}

describe("computeEstimateReport", () => {
  it("sums planned hours across all blocks in a group, done or not", () => {
    const rows = [row({ hours: 7 }), row({ hours: 3, status: "done", actualHours: 8 })];
    const result = computeEstimateReport(rows);
    expect(result).toHaveLength(1);
    expect(result[0].plannedHours).toBe(10);
  });

  it("only counts actual hours and block count from Done blocks", () => {
    const rows = [
      row({ hours: 7, status: "planned" }),
      row({ hours: 8, status: "done", actualHours: 9 }),
      row({ hours: 8, status: "behind", actualHours: 4 }),
    ];
    const result = computeEstimateReport(rows);
    expect(result[0].actualHours).toBe(9);
    expect(result[0].doneBlockCount).toBe(1);
  });

  it("computes difference as actual minus planned", () => {
    const rows = [row({ hours: 10, status: "done", actualHours: 14 })];
    expect(computeEstimateReport(rows)[0].difference).toBe(4);
  });

  it("suggests a new default only once there are at least three completed blocks", () => {
    const twoRows = [
      row({ hours: 7, status: "done", actualHours: 6 }),
      row({ hours: 7, status: "done", actualHours: 8 }),
    ];
    expect(computeEstimateReport(twoRows)[0].suggestedDefault).toBeNull();

    const threeRows = [...twoRows, row({ hours: 7, status: "done", actualHours: 7 })];
    const result = computeEstimateReport(threeRows);
    expect(result[0].doneBlockCount).toBe(3);
    expect(result[0].suggestedDefault).toBeCloseTo(7); // (6+8+7)/3
  });

  it("groups separately by Video Type and by stage", () => {
    const rows = [
      row({ videoType: "Youtube Narrative", stage: "Edit", hours: 10 }),
      row({ videoType: "Youtube Discovery", stage: "Edit", hours: 5 }),
      row({ videoType: "Youtube Narrative", stage: "Review", hours: 2 }),
    ];
    expect(computeEstimateReport(rows)).toHaveLength(3);
  });

  it("excludes a block with no Video Type or no detected stage", () => {
    const rows = [row({ videoType: null, hours: 7 }), row({ stage: null, hours: 7 })];
    expect(computeEstimateReport(rows)).toEqual([]);
  });

  it("sorts by Video Type then stage", () => {
    const rows = [
      row({ videoType: "Youtube Narrative", stage: "Review", hours: 1 }),
      row({ videoType: "Trade", stage: "Edit", hours: 1 }),
      row({ videoType: "Youtube Narrative", stage: "Edit", hours: 1 }),
    ];
    const result = computeEstimateReport(rows);
    expect(result.map((r) => `${r.videoType}:${r.stage}`)).toEqual(["Trade:Edit", "Youtube Narrative:Edit", "Youtube Narrative:Review"]);
  });
});

describe("estimateReportToCsv", () => {
  it("includes a header row and one row per entry", () => {
    const rows = computeEstimateReport([row({ hours: 7, status: "done", actualHours: 8 })]);
    const csv = estimateReportToCsv(rows);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("Video Type,Stage,Planned Hours,Actual Hours,Done Blocks,Difference,Suggested Default");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("Youtube Narrative");
  });

  it("leaves Suggested Default blank when there aren't enough completed blocks", () => {
    const rows = computeEstimateReport([row({ hours: 7, status: "done", actualHours: 8 })]);
    const csv = estimateReportToCsv(rows);
    expect(csv.split("\n")[1].endsWith(',""')).toBe(true);
  });
});
