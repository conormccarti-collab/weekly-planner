import { describe, expect, it } from "vitest";
import { computeStageInfo, videoTypeOf } from "@/lib/asana/stage-context";
import type { TaskGroup, TaskRow } from "@/lib/asana/task-view";

function task(overrides: Partial<TaskRow>): TaskRow {
  return {
    gid: "x",
    name: "x",
    parent_gid: "root",
    parent_name: "Deliverable",
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

describe("computeStageInfo", () => {
  it("when the Edit subtask is the user's own work, Review is a 48-hour wait regardless of who it's assigned to", () => {
    const root = task({ gid: "root", name: "Deliverable", is_container: true, is_plannable: false });
    const edit = task({ gid: "e1", name: "Edit", is_plannable: true });
    const review = task({ gid: "r1", name: "Review", is_plannable: false, assignee_name: "A Colleague" });
    const group: TaskGroup = { root, descendants: [edit, review] };

    const info = computeStageInfo(group);
    expect(info.get("e1")).toEqual({ stage: "Edit", focusType: "deep" });
    expect(info.get("r1")).toEqual({ stage: "Review", focusType: "waiting" });
  });

  it("when the Edit subtask belongs to someone else, a Review assigned to the user is a short shallow task", () => {
    const root = task({ gid: "root", name: "Deliverable", is_container: true, is_plannable: false });
    const edit = task({ gid: "e1", name: "Edit", is_plannable: false, assignee_name: "A Colleague" });
    const review = task({ gid: "r1", name: "Review", is_plannable: true });
    const group: TaskGroup = { root, descendants: [edit, review] };

    const info = computeStageInfo(group);
    expect(info.get("r1")).toEqual({ stage: "Review", focusType: "shallow" });
  });

  it("defaults Review to shallow when there's no Edit sibling to check", () => {
    const root = task({ gid: "root", name: "Deliverable", is_container: true, is_plannable: false });
    const review = task({ gid: "r1", name: "Review", is_plannable: true });
    const group: TaskGroup = { root, descendants: [review] };

    const info = computeStageInfo(group);
    expect(info.get("r1")).toEqual({ stage: "Review", focusType: "shallow" });
  });

  it("a task with no recognised stage is a plain shallow task", () => {
    const root = task({ gid: "root", name: "Inform HES about filming?", is_container: false });
    const group: TaskGroup = { root, descendants: [] };

    const info = computeStageInfo(group);
    expect(info.get("root")).toEqual({ stage: null, focusType: "shallow" });
  });

  it("recognises misspelt stage names within a real group", () => {
    const root = task({ gid: "root", name: "Deliverable", is_container: true, is_plannable: false });
    const preEdit = task({ gid: "p1", name: "Pre-Edit Revire & Brief", is_plannable: true });
    const group: TaskGroup = { root, descendants: [preEdit] };

    const info = computeStageInfo(group);
    expect(info.get("p1")).toEqual({ stage: "Pre-Edit Review & Brief", focusType: "deep" });
  });
});

describe("videoTypeOf", () => {
  it("reads the Video Type custom field", () => {
    expect(videoTypeOf(task({ custom_fields: { "Video Type": "Youtube Narrative" } }))).toBe(
      "Youtube Narrative"
    );
  });

  it("is null when there's no Video Type field", () => {
    expect(videoTypeOf(task({ custom_fields: {} }))).toBeNull();
  });

  it("trims whitespace (v4 Stage 3, brief 6.4)", () => {
    expect(videoTypeOf(task({ custom_fields: { "Video Type": "  Paid " } }))).toBe("Paid");
  });

  it("accepts \"Trade Partner\" as Trade on Production & Shoots", () => {
    expect(
      videoTypeOf(task({ project_names: ["Production & Shoots"], custom_fields: { "Video Type": "Trade Partner" } }))
    ).toBe("Trade");
  });

  it("does not apply the Trade Partner synonym outside Production & Shoots", () => {
    expect(
      videoTypeOf(task({ project_names: ["Visual Content Pipeline"], custom_fields: { "Video Type": "Trade Partner" } }))
    ).toBe("Trade Partner");
  });
});
