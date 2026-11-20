import { describe, expect, it } from "vitest";
import { blockerWarning, isBlocked, unfinishedBlockers } from "@/lib/asana/dependencies";

describe("unfinishedBlockers", () => {
  it("returns only the incomplete blockers", () => {
    const result = unfinishedBlockers([
      { gid: "1", name: "Shoot 1", completed: true },
      { gid: "2", name: "Shoot 2", completed: false },
    ]);
    expect(result).toEqual([{ gid: "2", name: "Shoot 2", completed: false }]);
  });

  it("is empty when every blocker is done", () => {
    expect(unfinishedBlockers([{ gid: "1", name: "Shoot 1", completed: true }])).toEqual([]);
  });
});

describe("blockerWarning", () => {
  it("is undefined when there are no blockers", () => {
    expect(blockerWarning([])).toBeUndefined();
  });

  it("is undefined when every blocker is done", () => {
    expect(blockerWarning([{ gid: "1", name: "Shoot 1", completed: true }])).toBeUndefined();
  });

  it("names every unfinished blocker", () => {
    const result = blockerWarning([
      { gid: "1", name: "Shoot 1 - England", completed: false },
      { gid: "2", name: "Shoot 2 - Mill", completed: false },
    ]);
    expect(result).toBe("Still waiting on: Shoot 1 - England, Shoot 2 - Mill");
  });
});

describe("isBlocked", () => {
  it("is false when there are no blockers", () => {
    expect(isBlocked([], new Map())).toBe(false);
  });

  it("is false when every blocker is completed", () => {
    const completedByGid = new Map([["1", true], ["2", true]]);
    expect(isBlocked(["1", "2"], completedByGid)).toBe(false);
  });

  it("is true when any blocker is incomplete", () => {
    const completedByGid = new Map([["1", true], ["2", false]]);
    expect(isBlocked(["1", "2"], completedByGid)).toBe(true);
  });

  it("treats a blocker missing from the map as still blocking", () => {
    expect(isBlocked(["unknown"], new Map())).toBe(true);
  });
});
