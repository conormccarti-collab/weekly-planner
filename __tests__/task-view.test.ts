import { describe, expect, it } from "vitest";
import { groupTasksByRoot, containerHasNothingToPlan, type TaskRow } from "@/lib/asana/task-view";

function task(overrides: Partial<TaskRow> & { gid: string }): TaskRow {
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

describe("groupTasksByRoot", () => {
  it("groups a container and its subtasks together, container never plannable", () => {
    const container = task({ gid: "1", is_container: true, is_plannable: false });
    const subtask = task({ gid: "2", parent_gid: "1", is_plannable: true });
    const groups = groupTasksByRoot([container, subtask]);

    expect(groups).toHaveLength(1);
    expect(groups[0].root.gid).toBe("1");
    expect(groups[0].descendants.map((d) => d.gid)).toEqual(["2"]);
  });

  it("groups depth-3 nested subtasks under the top-level container", () => {
    const container = task({ gid: "1", is_container: true, is_plannable: false });
    const mid = task({ gid: "2", parent_gid: "1", is_container: true, is_plannable: false });
    const leaf = task({ gid: "3", parent_gid: "2", is_plannable: true });
    const groups = groupTasksByRoot([container, mid, leaf]);

    expect(groups).toHaveLength(1);
    expect(groups[0].descendants.map((d) => d.gid).sort()).toEqual(["2", "3"]);
  });

  it("a container with no plannable descendants reports nothing left to plan", () => {
    const container = task({ gid: "1", is_container: true, is_plannable: false });
    const someoneElses = task({ gid: "2", parent_gid: "1", is_plannable: false });
    const groups = groupTasksByRoot([container, someoneElses]);

    expect(containerHasNothingToPlan(groups[0])).toBe(true);
  });

  it("a container with a plannable descendant has work to plan", () => {
    const container = task({ gid: "1", is_container: true, is_plannable: false });
    const plannable = task({ gid: "2", parent_gid: "1", is_plannable: true });
    const groups = groupTasksByRoot([container, plannable]);

    expect(containerHasNothingToPlan(groups[0])).toBe(false);
  });
});
