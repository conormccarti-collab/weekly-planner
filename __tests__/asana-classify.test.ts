import { describe, expect, it } from "vitest";
import { classifyTask } from "@/lib/asana/classify";

const ME = "me-gid";

describe("classifyTask", () => {
  it("a task with subtasks is a container and is never plannable", () => {
    expect(classifyTask(2, ME, ME)).toEqual({ isContainer: true, isPlannable: false });
  });

  it("an unassigned subtask is plannable (treated as the user's work)", () => {
    expect(classifyTask(0, null, ME)).toEqual({ isContainer: false, isPlannable: true });
  });

  it("a subtask assigned to the user is plannable", () => {
    expect(classifyTask(0, ME, ME)).toEqual({ isContainer: false, isPlannable: true });
  });

  it("a subtask assigned to someone else is shown for context only, never planned", () => {
    expect(classifyTask(0, "someone-else-gid", ME)).toEqual({
      isContainer: false,
      isPlannable: false,
    });
  });

  describe("Review (v2, 18 Nov 2026): plannable only when assigned to the user by name", () => {
    it("is plannable when assigned to the user", () => {
      expect(classifyTask(0, ME, ME, "Review")).toEqual({ isContainer: false, isPlannable: true });
    });

    it("is NOT plannable when unassigned, unlike an ordinary subtask", () => {
      expect(classifyTask(0, null, ME, "Review")).toEqual({ isContainer: false, isPlannable: false });
    });

    it("is not plannable when assigned to someone else", () => {
      expect(classifyTask(0, "someone-else-gid", ME, "Review")).toEqual({ isContainer: false, isPlannable: false });
    });

    it("a container named Review is still never plannable", () => {
      expect(classifyTask(2, ME, ME, "Review")).toEqual({ isContainer: true, isPlannable: false });
    });
  });
});
