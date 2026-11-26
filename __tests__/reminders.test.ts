import { describe, expect, it, vi } from "vitest";
import {
  createCheckoffReminder,
  retractCheckoffReminder,
  createNewProjectReminder,
  isCheckoffStillPending,
  isNewProjectReminderStillPending,
  mostFrequentValue,
} from "@/lib/reminders";
import { addWorkingDays } from "@/lib/time";

describe("isCheckoffStillPending", () => {
  it("excludes a task that's now completed in Asana (auto-resolve)", () => {
    expect(isCheckoffStillPending({ completed: true })).toBe(false);
  });

  it("excludes a task that no longer exists", () => {
    expect(isCheckoffStillPending(null)).toBe(false);
    expect(isCheckoffStillPending(undefined)).toBe(false);
  });

  it("keeps a task that's still not completed", () => {
    expect(isCheckoffStillPending({ completed: false })).toBe(true);
  });
});

describe("createCheckoffReminder / retractCheckoffReminder", () => {
  function throwingSupabase() {
    return { from: vi.fn(() => { throw new Error("should not be called for a personal task"); }) } as never;
  }

  it("is a no-op for a personal task (no Asana counterpart to check off)", async () => {
    await expect(createCheckoffReminder(throwingSupabase(), "user-1", "personal", "ref-1")).resolves.toBeUndefined();
    await expect(retractCheckoffReminder(throwingSupabase(), "user-1", "personal", "ref-1")).resolves.toBeUndefined();
  });

  it("upserts on the (user_id, kind, reference) constraint for an asana task", async () => {
    const upsert = vi.fn(() => Promise.resolve({ data: null, error: null }));
    const supabase = { from: vi.fn(() => ({ upsert })) } as never;

    await createCheckoffReminder(supabase, "user-1", "asana", "gid-1");

    expect(upsert).toHaveBeenCalledWith(
      { user_id: "user-1", kind: "asana_checkoff", reference: "gid-1", dismissed_at: null },
      { onConflict: "user_id,kind,reference" }
    );
  });
});

describe("isNewProjectReminderStillPending", () => {
  it("auto-resolves once the project is added to planned_project_gids", () => {
    expect(isNewProjectReminderStillPending("gid-1", ["gid-1", "gid-2"])).toBe(false);
  });

  it("stays pending while the project is still outside the workflow", () => {
    expect(isNewProjectReminderStillPending("gid-3", ["gid-1", "gid-2"])).toBe(true);
  });
});

describe("createNewProjectReminder", () => {
  it("upserts on the (user_id, kind, reference) constraint, reference being the project gid", async () => {
    const upsert = vi.fn(() => Promise.resolve({ data: null, error: null }));
    const supabase = { from: vi.fn(() => ({ upsert })) } as never;

    await createNewProjectReminder(supabase, "user-1", "project-gid-1");

    expect(upsert).toHaveBeenCalledWith(
      { user_id: "user-1", kind: "new_outside_project", reference: "project-gid-1", dismissed_at: null },
      { onConflict: "user_id,kind,reference" }
    );
  });
});

describe("mostFrequentValue", () => {
  it("picks the real 'me' gid over stray one-off rows (e.g. a cached blocker task's owner)", () => {
    const values = ["me-gid", "me-gid", "me-gid", "other-1", "other-2"];
    expect(mostFrequentValue(values)).toBe("me-gid");
  });

  it("returns undefined for an empty list", () => {
    expect(mostFrequentValue([])).toBeUndefined();
  });
});

describe("reminders reuse the same 2-working-day deadline window as 'at risk'", () => {
  it("matches lib/summary.ts's deadlineCutoff computation", () => {
    const workingDays: import("@/lib/time").Weekday[] = ["mon", "tue", "wed", "thu", "fri"];
    expect(addWorkingDays("2026-11-25", 2, workingDays)).toBe("2026-11-27");
  });
});
