import { describe, expect, it } from "vitest";
import { isPlannableGroup, partitionByEligibility } from "@/lib/asana/eligibility";
import type { TaskGroup, TaskRow } from "@/lib/asana/task-view";

const PIPELINE = "pipeline-gid";
const SHOOTS = "shoots-gid";
const OTHER = "other-gid";
const PLANNED = [PIPELINE, SHOOTS];

function root(overrides: Partial<TaskRow> & { gid: string }): TaskRow {
  return {
    name: overrides.gid,
    parent_gid: null,
    parent_name: null,
    project_gids: [],
    project_names: [],
    section_names: [],
    due_on: null,
    start_on: null,
    completed: false,
    custom_fields: {},
    permalink_url: null,
    assignee_name: null,
    is_container: false,
    is_plannable: true,
    is_shoot: false,
    no_longer_assigned: false,
    blocked_by_gids: [],
    ...overrides,
  };
}

function group(rootOverrides: Partial<TaskRow> & { gid: string }): TaskGroup {
  return { root: root(rootOverrides), descendants: [] };
}

describe("isPlannableGroup", () => {
  it("is true for a root in a planned project", () => {
    expect(isPlannableGroup(group({ gid: "1", project_gids: [PIPELINE] }), PLANNED)).toBe(true);
  });

  it("is true for a root in Production & Shoots", () => {
    expect(isPlannableGroup(group({ gid: "1", project_gids: [SHOOTS] }), PLANNED)).toBe(true);
  });

  it("is false for a root in an unrelated project (e.g. website SEO, Phase 1 Assets)", () => {
    expect(isPlannableGroup(group({ gid: "1", project_gids: [OTHER] }), PLANNED)).toBe(false);
  });

  it("is false for a root with no project membership at all", () => {
    expect(isPlannableGroup(group({ gid: "1", project_gids: [] }), PLANNED)).toBe(false);
  });

  it("is false for an orphaned subtask masquerading as a root (non-null parent_gid), even in a planned project", () => {
    expect(isPlannableGroup(group({ gid: "1", project_gids: [PIPELINE], parent_gid: "completed-parent" }), PLANNED)).toBe(false);
  });

  it("is true when a root sits in both a planned and an unrelated project", () => {
    expect(isPlannableGroup(group({ gid: "1", project_gids: [PIPELINE, OTHER] }), PLANNED)).toBe(true);
  });
});

describe("partitionByEligibility", () => {
  it("splits groups into eligible and outside-the-workflow", () => {
    const groups = [
      group({ gid: "a", project_gids: [PIPELINE] }),
      group({ gid: "b", project_gids: [OTHER] }),
      group({ gid: "c", project_gids: [] }),
    ];
    const { eligible, outsideWorkflow } = partitionByEligibility(groups, PLANNED);
    expect(eligible.map((g) => g.root.gid)).toEqual(["a"]);
    expect(outsideWorkflow.map((g) => g.root.gid)).toEqual(["b", "c"]);
  });
});
