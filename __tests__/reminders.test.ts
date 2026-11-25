import { describe, expect, it, vi } from "vitest";
import { createCheckoffReminder, retractCheckoffReminder, isCheckoffStillPending, mostFrequentValue } from "@/lib/reminders";
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
