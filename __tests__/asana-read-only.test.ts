import { describe, expect, it, vi, beforeEach } from "vitest";
import * as asanaClient from "@/lib/asana/client";

// Brief section 2, rule 1: "The Asana client may only issue GET requests."
// Add a test that fails if any non-GET Asana call exists.
describe("Asana client is read-only", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.ASANA_PAT = "test-pat";
    fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [] }),
      text: async () => "",
    }));
    vi.stubGlobal("fetch", fetchMock);
  });

  it("every exported Asana client function issues only GET requests", async () => {
    await asanaClient.getMe();
    await asanaClient.listTasksAssignedToMe("workspace-gid", new Date().toISOString());
    await asanaClient.getTask("task-gid");
    await asanaClient.listSubtasks("task-gid");

    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const call of fetchMock.mock.calls) {
      const [, init] = call;
      expect(init?.method).toBe("GET");
    }
  });

  it("the client module source contains no mutating HTTP verb", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.resolve(__dirname, "../lib/asana/client.ts"),
      "utf8"
    );
    expect(source).not.toMatch(/method:\s*["'](POST|PUT|PATCH|DELETE)["']/i);
  });
});
