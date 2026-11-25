import { describe, expect, it, vi, beforeEach } from "vitest";
import * as asanaClient from "@/lib/asana/client";

// Brief section 2, rule 1: "The Asana client may only issue GET requests."
// No write-back functionality exists in this app — every exported function
// must send only GET.
describe("Asana client is read-only", () => {
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

  it("every exported function issues only GET requests", async () => {
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

  it("the client module source has no mutating HTTP verb", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(path.resolve(__dirname, "../lib/asana/client.ts"), "utf8");
    expect(source).not.toMatch(/method:\s*["'](POST|PUT|PATCH|DELETE)["']/i);
  });
});
