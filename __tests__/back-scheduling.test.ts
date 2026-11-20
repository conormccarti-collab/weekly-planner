import { describe, expect, it } from "vitest";
import { computeLatestStarts, type BackSchedulingStage } from "@/lib/back-scheduling";

/** Mon-Fri, 7h/day, no leave. */
function flatCapacity(dateStr: string): number {
  const day = new Date(dateStr + "T00:00:00Z").getUTCDay(); // 0=Sun..6=Sat
  return day === 0 || day === 6 ? 0 : 7;
}

function stage(overrides: Partial<BackSchedulingStage> & { gid: string; stage: BackSchedulingStage["stage"] }): BackSchedulingStage {
  return { confirmedHours: null, ownDueOn: null, ...overrides };
}

describe("computeLatestStarts", () => {
  it("walks backward from the publish date through working days only", () => {
    // Publish on a Friday (2026-11-20). Edit needs 14h (2 full 7h days).
    const result = computeLatestStarts(
      "2026-11-20",
      [stage({ gid: "edit", stage: "Edit", confirmedHours: 14 })],
      flatCapacity
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 2026-11-20 (Fri, 7h) covers 7h, 2026-11-19 (Thu, 7h) covers the rest — latest start is Thursday.
    expect(result.starts).toEqual([{ gid: "edit", stage: "Edit", latestStartDate: "2026-11-19", deadline: "2026-11-20" }]);
  });

  it("skips a weekend when walking backward", () => {
    // Publish on a Monday (2026-11-23). 7h needed — the only capacity day backward within 7h is the Monday itself (weekend has 0).
    const result = computeLatestStarts("2026-11-23", [stage({ gid: "e", stage: "Edit", confirmedHours: 7 })], flatCapacity);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.starts[0].latestStartDate).toBe("2026-11-23");
  });

  it("skips a week of leave (zero capacity) when walking backward", () => {
    // The week of 2026-11-16 to 2026-11-20 (Mon-Fri) is all leave.
    const leaveWeek = new Set(["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"]);
    const capacityWithLeave = (d: string) => (leaveWeek.has(d) ? 0 : flatCapacity(d));
    // Publish Monday 2026-11-30, 49h needed (7 working days' worth).
    // Backward: 11-30, 11-27, 11-26, 11-25, 11-24, 11-23 (6 real days, 42h),
    // then 11-22/11-21 (weekend, 0) and the whole leave week (11-20..11-16, 0),
    // so the 7th real-capacity day backward is 11-13 (Fri).
    const result = computeLatestStarts("2026-11-30", [stage({ gid: "e", stage: "Edit", confirmedHours: 49 })], capacityWithLeave);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.starts[0].latestStartDate).toBe("2026-11-13");
  });

  it("is 'can't compute' when any stage has no confirmed estimate", () => {
    const result = computeLatestStarts(
      "2026-11-20",
      [stage({ gid: "e", stage: "Edit", confirmedHours: 14 }), stage({ gid: "r", stage: "Revisions", confirmedHours: null })],
      flatCapacity
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("needs estimate");
  });

  it("keeps stages in template order, working backward through the chain", () => {
    const result = computeLatestStarts(
      "2026-11-20",
      [
        stage({ gid: "pre", stage: "Pre-Edit Review & Brief", confirmedHours: 7 }),
        stage({ gid: "edit", stage: "Edit", confirmedHours: 7 }),
      ],
      flatCapacity
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Edit's deadline is the publish date (2026-11-20, a Friday) and it
    // fits in that one day; Pre-Edit must then finish the day before,
    // since Edit's latest-start day is spoken for.
    const edit = result.starts.find((s) => s.gid === "edit")!;
    const pre = result.starts.find((s) => s.gid === "pre")!;
    expect(edit.latestStartDate).toBe("2026-11-20");
    expect(pre.deadline).toBe("2026-11-19");
    expect(pre.latestStartDate).toBe("2026-11-19");
  });

  it("excludes Archive from the chain", () => {
    const result = computeLatestStarts(
      "2026-11-20",
      [stage({ gid: "edit", stage: "Edit", confirmedHours: 7 }), stage({ gid: "archive", stage: "Archive", confirmedHours: 1000 })],
      flatCapacity
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.starts.map((s) => s.gid)).toEqual(["edit"]);
  });

  it("uses a stage's own due date as its deadline instead of the downstream cursor", () => {
    const result = computeLatestStarts(
      "2026-12-04",
      [stage({ gid: "edit", stage: "Edit", confirmedHours: 7, ownDueOn: "2026-11-20" })],
      flatCapacity
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.starts[0].deadline).toBe("2026-11-20");
    expect(result.starts[0].latestStartDate).toBe("2026-11-20");
  });

  it("warns when the Edit due date is later than what the publish date allows", () => {
    // Edit due 2026-11-20, but Revisions (after it) needs 7h before a 2026-11-20 publish — so Edit must really finish earlier.
    const result = computeLatestStarts(
      "2026-11-20",
      [
        stage({ gid: "edit", stage: "Edit", confirmedHours: 7, ownDueOn: "2026-11-20" }),
        stage({ gid: "rev", stage: "Revisions", confirmedHours: 7 }),
      ],
      flatCapacity
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.editDueDateWarning).toContain("2026-11-20");
  });

  it("no warning when the Edit due date already meets the publish date", () => {
    const result = computeLatestStarts(
      "2026-11-20",
      [stage({ gid: "edit", stage: "Edit", confirmedHours: 7, ownDueOn: "2026-11-19" })],
      flatCapacity
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.editDueDateWarning).toBeNull();
  });
});
