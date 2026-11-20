import { describe, expect, it } from "vitest";
import { checkBrand, checkColumnMatchesStage, checkGroupDates, checkUnmatchedStage, checkVideoType, isGenuinePipelineDeliverable } from "@/lib/hygiene";
import type { TaskGroup, TaskRow } from "@/lib/asana/task-view";

function task(overrides: Partial<TaskRow> & { gid: string }): TaskRow {
  return {
    name: overrides.gid,
    parent_gid: null,
    parent_name: null,
    project_names: [],
    section_names: [],
    due_on: null,
    start_on: null,
    completed: false,
    custom_fields: {},
    permalink_url: `https://app.asana.com/0/0/${overrides.gid}`,
    assignee_name: null,
    is_container: false,
    is_plannable: true,
    is_shoot: false,
    no_longer_assigned: false,
    blocked_by_gids: [],
    ...overrides,
  };
}

describe("checkVideoType", () => {
  it("flags a blank Video Type", () => {
    const result = checkVideoType(task({ gid: "1" }));
    expect(result).toEqual([{ gid: "1", name: "1", permalinkUrl: "https://app.asana.com/0/0/1", issue: "Video Type is blank" }]);
  });

  it("accepts every one of the nine known values, case-insensitively", () => {
    for (const value of ["Youtube Narrative", "youtube discovery", "WEBSITE", "Paid", "Trade", "wpt", "Internal", "Photography", "Special Projects"]) {
      expect(checkVideoType(task({ gid: "1", custom_fields: { "Video Type": value } }))).toEqual([]);
    }
  });

  it("flags an unrecognised value", () => {
    const result = checkVideoType(task({ gid: "1", custom_fields: { "Video Type": "Nonsense" } }));
    expect(result[0].issue).toBe('Video Type "Nonsense" isn\'t one of the nine known values');
  });
});

describe("checkBrand", () => {
  it("flags a blank Brand", () => {
    expect(checkBrand(task({ gid: "1" }))).toEqual([
      { gid: "1", name: "1", permalinkUrl: "https://app.asana.com/0/0/1", issue: "Brand is blank" },
    ]);
  });

  it("passes when Brand is set", () => {
    expect(checkBrand(task({ gid: "1", custom_fields: { Brand: "Scotland" } }))).toEqual([]);
  });
});

describe("checkUnmatchedStage", () => {
  it("flags a name that matches no stage", () => {
    const result = checkUnmatchedStage(task({ gid: "1", name: "Series: Ep 3" }));
    expect(result[0].issue).toBe("Name doesn't match any known stage");
  });

  it("passes a recognised stage name", () => {
    expect(checkUnmatchedStage(task({ gid: "1", name: "Edit" }))).toEqual([]);
  });
});

describe("checkGroupDates", () => {
  function group(root: TaskRow, descendants: TaskRow[] = []): TaskGroup {
    return { root, descendants };
  }

  it("flags a missing publish date on the parent of a real deliverable", () => {
    const root = task({ gid: "root", is_container: true, due_on: null });
    const edit = task({ gid: "edit", name: "Edit", due_on: "2026-12-01" });
    const result = checkGroupDates(group(root, [edit]));
    expect(result).toContainEqual({ gid: "root", name: "root", permalinkUrl: "https://app.asana.com/0/0/root", issue: "Missing publish date on the parent" });
  });

  it("does not flag the parent when it isn't a stage-based deliverable", () => {
    const root = task({ gid: "root", is_container: true, due_on: null });
    const plain = task({ gid: "plain", name: "Update branded PDFs", due_on: "2026-12-01" });
    const result = checkGroupDates(group(root, [plain]));
    expect(result).toEqual([]);
  });

  it("flags a missing due date on the Edit subtask, attributed to the parent", () => {
    const root = task({ gid: "root", is_container: true, due_on: "2026-12-01" });
    const edit = task({ gid: "edit", name: "Edit", due_on: null });
    const result = checkGroupDates(group(root, [edit]));
    expect(result).toContainEqual({ gid: "root", name: "root", permalinkUrl: "https://app.asana.com/0/0/root", issue: "Missing due date on the Edit subtask" });
  });

  it("flags a shoot task with neither a start nor a due date, attributed to the parent", () => {
    const root = task({ gid: "root", is_container: true, due_on: "2026-12-01" });
    const shoot = task({ gid: "shoot", name: "Shoot 1 - England", is_shoot: true, due_on: null, start_on: null });
    const result = checkGroupDates(group(root, [shoot]));
    expect(result).toContainEqual({ gid: "root", name: "root", permalinkUrl: "https://app.asana.com/0/0/root", issue: "Missing shoot date (Shoot 1 - England)" });
  });

  it("does not flag a shoot task that has a due date", () => {
    const root = task({ gid: "root", is_container: true, due_on: "2026-12-01" });
    const shoot = task({ gid: "shoot", name: "Shoot 1", is_shoot: true, due_on: "2026-11-20", start_on: null });
    const result = checkGroupDates(group(root, [shoot]));
    expect(result.find((f) => f.gid === "shoot")).toBeUndefined();
  });

  it("is clean for a fully-dated deliverable", () => {
    const root = task({ gid: "root", is_container: true, due_on: "2026-12-01" });
    const edit = task({ gid: "edit", name: "Edit", due_on: "2026-11-20" });
    const shoot = task({ gid: "shoot", name: "Shoot 1", is_shoot: true, due_on: "2026-11-15", start_on: null });
    expect(checkGroupDates(group(root, [edit, shoot]))).toEqual([]);
  });
});

describe("checkColumnMatchesStage", () => {
  function group(root: TaskRow, descendants: TaskRow[] = []): TaskGroup {
    return { root, descendants };
  }

  it("passes when the card sits in the column of its earliest unfinished stage", () => {
    const root = task({ gid: "root", is_container: true, section_names: ["Edit"] });
    const edit = task({ gid: "edit", name: "Edit" });
    expect(checkColumnMatchesStage(group(root, [edit]))).toEqual([]);
  });

  it("flags a card sitting in the wrong column for its earliest unfinished stage", () => {
    const root = task({ gid: "root", is_container: true, section_names: ["Review"] });
    const edit = task({ gid: "edit", name: "Edit" });
    const result = checkColumnMatchesStage(group(root, [edit]));
    expect(result).toEqual([
      { gid: "root", name: "root", permalinkUrl: "https://app.asana.com/0/0/root", issue: 'In "Review" but its earliest unfinished stage (Edit) belongs in "Edit"' },
    ]);
  });

  it("maps Pre-Edit Review & Brief and Edit both to the Edit column", () => {
    const root = task({ gid: "root", is_container: true, section_names: ["Edit"] });
    const preEdit = task({ gid: "pre", name: "Pre-Edit Review & Brief" });
    expect(checkColumnMatchesStage(group(root, [preEdit]))).toEqual([]);
  });

  it("maps Review and Revisions both to the Review column", () => {
    const root = task({ gid: "root", is_container: true, section_names: ["Review"] });
    const revisions = task({ gid: "rev", name: "Revisions" });
    expect(checkColumnMatchesStage(group(root, [revisions]))).toEqual([]);
  });

  it("maps Shorts, Publish and Archive all to Publish / Deliver", () => {
    const root = task({ gid: "root", is_container: true, section_names: ["Publish / Deliver"] });
    for (const name of ["Shorts", "Publish", "Archive"]) {
      const subtask = task({ gid: "s", name });
      expect(checkColumnMatchesStage(group(root, [subtask]))).toEqual([]);
    }
  });

  it("uses the earliest unfinished stage, not just any matching one", () => {
    const root = task({ gid: "root", is_container: true, section_names: ["Edit"] });
    const edit = task({ gid: "edit", name: "Edit" });
    const review = task({ gid: "review", name: "Review" });
    expect(checkColumnMatchesStage(group(root, [edit, review]))).toEqual([]);
  });

  it("expects Backlog when no known stage is still open — not commissioned", () => {
    const root = task({ gid: "root", is_container: true, section_names: ["Pre-Production"] });
    const plain = task({ gid: "plain", name: "Update branded PDFs" });
    const result = checkColumnMatchesStage(group(root, [plain]));
    expect(result[0].issue).toBe('In "Pre-Production" but its earliest unfinished stage (not commissioned) belongs in "Backlog"');
  });

  it("matches case- and punctuation-insensitively", () => {
    const root = task({ gid: "root", is_container: true, section_names: ["  edit  "] });
    const edit = task({ gid: "edit", name: "Edit" });
    expect(checkColumnMatchesStage(group(root, [edit]))).toEqual([]);
  });
});

describe("isGenuinePipelineDeliverable", () => {
  function group(root: TaskRow, descendants: TaskRow[] = []): TaskGroup {
    return { root, descendants };
  }

  it("accepts a genuine root in Visual Content Pipeline", () => {
    const root = task({ gid: "root", project_names: ["Visual Content Pipeline"] });
    expect(isGenuinePipelineDeliverable(group(root))).toBe(true);
  });

  it("rejects a task outside Visual Content Pipeline", () => {
    const root = task({ gid: "root", project_names: ["Production & Shoots"] });
    expect(isGenuinePipelineDeliverable(group(root))).toBe(false);
  });

  it("rejects an orphaned subtask whose real parent is completed or unsynced (it has a parent_gid of its own)", () => {
    const fakeRoot = task({ gid: "orphan", parent_gid: "gone", project_names: ["Visual Content Pipeline"] });
    expect(isGenuinePipelineDeliverable(group(fakeRoot))).toBe(false);
  });
});
