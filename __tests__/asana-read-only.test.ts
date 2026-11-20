import { describe, expect, it, vi, beforeEach } from "vitest";
import * as asanaClient from "@/lib/asana/client";

// Brief section 2, rule 1 (v4 Stage 10 revision): "The Asana client may
// issue writes for exactly two actions (complete a task, change its due
// date)... Until Stage 10 is built and accepted, the Asana client stays
// GET-only." Stage 10 is built: this replaces the blanket GET-only test
// with one asserting exactly these two writes exist, each sending only
// its own single field, and that every other function is still GET-only.
describe("Asana client writes only through the two approved Stage 10 actions", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.ASANA_PAT = "test-pat";
    fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: {} }),
      text: async () => "",
    }));
    vi.stubGlobal("fetch", fetchMock);
  });

  it("every read function issues only GET requests", async () => {
    await asanaClient.getMe();
    await asanaClient.listTasksAssignedToMe("workspace-gid", new Date().toISOString());
    await asanaClient.getTask("task-gid");
    await asanaClient.listSubtasks("task-gid");
    await asanaClient.listProjectTasks("project-gid", new Date().toISOString());

    expect(fetchMock).toHaveBeenCalledTimes(5);
    for (const call of fetchMock.mock.calls) {
      const [, init] = call;
      expect(init?.method).toBe("GET");
    }
  });

  it("completeTaskInAsana sends exactly one field: completed: true", async () => {
    await asanaClient.completeTaskInAsana("task-gid");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/tasks/task-gid");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ data: { completed: true } });
  });

  it("setTaskDueDateInAsana sends exactly one field: due_on", async () => {
    await asanaClient.setTaskDueDateInAsana("task-gid", "2026-12-01");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/tasks/task-gid");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ data: { due_on: "2026-12-01" } });
  });

  it("the client module source has no other mutating HTTP verb outside the one asanaPut helper", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(path.resolve(__dirname, "../lib/asana/client.ts"), "utf8");
    const mutatingVerbMatches = source.match(/method:\s*["'](POST|PUT|PATCH|DELETE)["']/gi) ?? [];
    // Exactly one call site sends a mutating verb (the shared asanaPut
    // helper) — completeTaskInAsana/setTaskDueDateInAsana both route
    // through it rather than each sending their own request.
    expect(mutatingVerbMatches).toHaveLength(1);
    expect(source).not.toMatch(/method:\s*["'](POST|PATCH|DELETE)["']/i);
  });

  it("the client exports no generic/arbitrary task-update function — only the two named single-field writes", () => {
    const exportNames = Object.keys(asanaClient);
    const writeExports = exportNames.filter((name) => !/^(get|list)/.test(name));
    expect(writeExports.sort()).toEqual(["completeTaskInAsana", "setTaskDueDateInAsana"]);
  });
});
