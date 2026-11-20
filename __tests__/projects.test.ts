import { describe, expect, it } from "vitest";
import { preferredProjectName } from "@/lib/asana/projects";
import { isInBacklog } from "@/lib/asana/task-view";
import type { TaskRow } from "@/lib/asana/task-view";

describe("preferredProjectName", () => {
  it("prefers Visual Content Pipeline when a task sits in both projects", () => {
    expect(preferredProjectName(["Long Form Video", "Visual Content Pipeline"])).toBe(
      "Visual Content Pipeline"
    );
  });

  it("falls back to joining all project names otherwise", () => {
    expect(preferredProjectName(["Long Form Video"])).toBe("Long Form Video");
    expect(preferredProjectName(["Long Form Video", "Rebranding Project"])).toBe(
      "Long Form Video, Rebranding Project"
    );
  });
});

function task(overrides: Partial<TaskRow>): TaskRow {
  return {
    gid: "x",
    name: "x",
    parent_gid: null,
    parent_name: null,
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

describe("isInBacklog", () => {
  it("is true when any section membership is Backlog", () => {
    expect(isInBacklog(task({ section_names: ["Backlog"] }))).toBe(true);
    expect(isInBacklog(task({ section_names: ["Edit", "Backlog"] }))).toBe(true);
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(isInBacklog(task({ section_names: [" backlog "] }))).toBe(true);
  });

  it("is false otherwise", () => {
    expect(isInBacklog(task({ section_names: ["Edit"] }))).toBe(false);
    expect(isInBacklog(task({ section_names: [] }))).toBe(false);
  });
});
