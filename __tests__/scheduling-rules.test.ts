import { describe, expect, it } from "vitest";
import { findRuleConflicts, countBlocksOnExcludedDay } from "@/lib/scheduling-rules";
import type { Weekday } from "@/lib/time";

const MON_TO_FRI: Weekday[] = ["mon", "tue", "wed", "thu", "fri"];

describe("findRuleConflicts", () => {
  it("flags two rules that exclude the exact same weekday and stage as duplicates", () => {
    const conflicts = findRuleConflicts(
      [
        { id: "a", weekday: "fri", stage: "Edit" },
        { id: "b", weekday: "fri", stage: "Edit" },
      ],
      MON_TO_FRI
    );
    expect(conflicts.get("a")).toBe("Duplicates another active rule");
    expect(conflicts.get("b")).toBe("Duplicates another active rule");
  });

  it("does not flag two rules for different stages on the same weekday", () => {
    const conflicts = findRuleConflicts(
      [
        { id: "a", weekday: "fri", stage: "Edit" },
        { id: "b", weekday: "fri", stage: "Publish" },
      ],
      MON_TO_FRI
    );
    expect(conflicts.size).toBe(0);
  });

  it("flags a stage whose every working day is excluded between a stage rule and a blanket rule", () => {
    const conflicts = findRuleConflicts(
      [
        { id: "a", weekday: "mon", stage: "Edit" },
        { id: "b", weekday: "tue", stage: "Edit" },
        { id: "c", weekday: "wed", stage: "Edit" },
        { id: "d", weekday: "thu", stage: "Edit" },
        { id: "e", weekday: "fri", stage: null }, // blanket rule covers the last working day
      ],
      MON_TO_FRI
    );
    expect(conflicts.get("a")).toMatch(/every working day for Edit/);
    expect(conflicts.get("e")).toMatch(/every working day for Edit/);
  });

  it("flags blanket rules alone covering every working day", () => {
    const conflicts = findRuleConflicts(
      MON_TO_FRI.map((weekday, i) => ({ id: `r${i}`, weekday, stage: null })),
      MON_TO_FRI
    );
    for (let i = 0; i < 5; i++) {
      expect(conflicts.get(`r${i}`)).toBe("Together, these rules exclude every working day entirely");
    }
  });

  it("reports no conflicts when rules leave at least one working day free per stage", () => {
    const conflicts = findRuleConflicts([{ id: "a", weekday: "fri", stage: "Edit" }], MON_TO_FRI);
    expect(conflicts.size).toBe(0);
  });
});

describe("countBlocksOnExcludedDay", () => {
  it("counts placed blocks that fall on the rule's excluded weekday", () => {
    const rule = { id: "a", weekday: "fri" as Weekday, stage: null };
    const count = countBlocksOnExcludedDay(rule, ["2026-11-23", "2026-11-27", "2026-11-28", "2026-12-04"]); // Mon, Fri, Sat, Fri
    expect(count).toBe(2);
  });

  it("returns 0 when nothing is placed on that weekday", () => {
    const rule = { id: "a", weekday: "sun" as Weekday, stage: null };
    expect(countBlocksOnExcludedDay(rule, ["2026-11-23", "2026-11-24"])).toBe(0);
  });
});
