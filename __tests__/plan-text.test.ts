import { describe, expect, it } from "vitest";
import { formatPlanAsText } from "@/lib/plan-text";

describe("formatPlanAsText", () => {
  const days = [
    { dateStr: "2026-11-16", label: "Monday", isWorkingDay: true },
    { dateStr: "2026-11-17", label: "Tuesday", isWorkingDay: true },
    { dateStr: "2026-11-21", label: "Saturday", isWorkingDay: false },
  ];

  it("skips non-working days", () => {
    const result = formatPlanAsText(days, [], []);
    expect(result).not.toContain("Saturday");
  });

  it("lists each day's blocks sorted by start time", () => {
    const result = formatPlanAsText(
      days,
      [
        { day: "2026-11-16", name: "Later task", startMinutes: 660, endMinutes: 720, status: "planned" },
        { day: "2026-11-16", name: "Earlier task", startMinutes: 540, endMinutes: 600, status: "planned" },
      ],
      []
    );
    const monday = result.split("\n\n")[0];
    expect(monday.indexOf("Earlier task")).toBeLessThan(monday.indexOf("Later task"));
    expect(monday).toContain("09:00–10:00 Earlier task");
  });

  it("marks done blocks with a checkmark", () => {
    const result = formatPlanAsText(
      days,
      [{ day: "2026-11-16", name: "Finished task", startMinutes: 540, endMinutes: 600, status: "done" }],
      []
    );
    expect(result).toContain("Finished task ✓");
  });

  it("shows a placeholder for a day with nothing placed", () => {
    const result = formatPlanAsText(days, [], []);
    expect(result).toContain("(nothing placed)");
  });

  it("lists unplaced tasks at the end", () => {
    const result = formatPlanAsText(days, [], [{ name: "Loose end", estimateDisplay: "2h" }]);
    expect(result).toContain("Unplaced:");
    expect(result).toContain("- Loose end (2h)");
  });

  it("omits the unplaced section entirely when there's nothing unplaced", () => {
    const result = formatPlanAsText(days, [], []);
    expect(result).not.toContain("Unplaced:");
  });
});
