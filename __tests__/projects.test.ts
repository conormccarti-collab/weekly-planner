import { describe, expect, it } from "vitest";
import { preferredProjectName, projectLabelsFor } from "@/lib/asana/projects";
import { isInBacklog } from "@/lib/asana/task-view";
import type { TaskRow } from "@/lib/asana/task-view";

describe("preferredProjectName", () => {
  it("prefers Visual Content Pipeline when a task sits in both projects", () => {
    expect(preferredProjectName(["Long Form Video", "Visual Content Pipeline"])).toBe(
      "Visual Content Pipeline"
    );
  });

  it("falls back to joining all project names otherwise (a single-task display string only — never used as a grouping key, see projectLabelsFor)", () => {
    expect(preferredProjectName(["Long Form Video"])).toBe("Long Form Video");
    expect(preferredProjectName(["Long Form Video", "Rebranding Project"])).toBe(
      "Long Form Video, Rebranding Project"
    );
  });

  it("v4: Pipeline alongside an unrelated project (not specifically Long Form Video) doesn't collapse — that was swallowing real projects like Black Friday 2026", () => {
    expect(preferredProjectName(["Visual Content Pipeline", "Black Friday 2026"])).toBe(
      "Visual Content Pipeline, Black Friday 2026"
    );
  });
});

describe("projectLabelsFor", () => {
  it("v4: collapses to Pipeline when the task sits in both, same as preferredProjectName", () => {
    expect(projectLabelsFor(["Long Form Video", "Visual Content Pipeline"])).toEqual(["Visual Content Pipeline"]);
  });

  it("v4: a task in one real project returns just that one", () => {
    expect(projectLabelsFor(["Cycling"])).toEqual(["Cycling"]);
  });

  it("v4: a task in two real (non-Pipeline) projects returns both separately — never joined into one phantom label", () => {
    expect(projectLabelsFor(["Cycling", "Walking"])).toEqual(["Cycling", "Walking"]);
  });

  it("v4: a task in no project returns an empty list — never attributed to Pipeline or anywhere else", () => {
    expect(projectLabelsFor([])).toEqual([]);
  });

  it("v4: Pipeline alongside an unrelated real project (not Long Form Video) doesn't swallow it — both show separately", () => {
    expect(projectLabelsFor(["Visual Content Pipeline", "Black Friday 2026"])).toEqual([
      "Visual Content Pipeline",
      "Black Friday 2026",
    ]);
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
