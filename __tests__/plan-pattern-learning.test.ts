import { describe, expect, it } from "vitest";
import { detectMovePatterns } from "@/lib/plan-pattern-learning";

function fakeSupabase(tables: Record<string, unknown[]>) {
  function builder(rows: unknown[]) {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b,
      eq: () => b,
      then: (resolve: (v: { data: unknown[] }) => void) => resolve({ data: rows }),
    });
    return b;
  }
  return { from: (table: string) => builder(tables[table] ?? []) } as never;
}

describe("detectMovePatterns", () => {
  it("suggests a stage+time-of-day rule once a stage moves the same way at least 3 times, consistently", async () => {
    const supabase = fakeSupabase({
      plan_events: [
        { source: "asana", reference: "g1", start_time: "09:00" },
        { source: "asana", reference: "g1", start_time: "09:30" },
        { source: "asana", reference: "g1", start_time: "10:00" },
      ],
      asana_tasks: [{ gid: "g1", name: "Edit" }],
      personal_tasks: [],
    });
    const result = await detectMovePatterns(supabase, "user-1");
    expect(result).toHaveLength(1);
    expect(result[0].patternKey).toBe("move_time_of_day:Edit:morning");
    expect(result[0].ruleText).toContain("Edit");
    expect(result[0].ruleText).toContain("morning");
  });

  it("returns nothing below the occurrence threshold", async () => {
    const supabase = fakeSupabase({
      plan_events: [
        { source: "asana", reference: "g1", start_time: "09:00" },
        { source: "asana", reference: "g1", start_time: "09:30" },
      ],
      asana_tasks: [{ gid: "g1", name: "Edit" }],
      personal_tasks: [],
    });
    expect(await detectMovePatterns(supabase, "user-1")).toEqual([]);
  });

  it("returns nothing when the destination is inconsistent (no clear majority)", async () => {
    const supabase = fakeSupabase({
      plan_events: [
        { source: "asana", reference: "g1", start_time: "09:00" },
        { source: "asana", reference: "g1", start_time: "09:30" },
        { source: "asana", reference: "g1", start_time: "14:00" },
        { source: "asana", reference: "g1", start_time: "15:00" },
      ],
      asana_tasks: [{ gid: "g1", name: "Edit" }],
      personal_tasks: [],
    });
    expect(await detectMovePatterns(supabase, "user-1")).toEqual([]);
  });

  it("ignores events for a task whose stage can't be detected from its name", async () => {
    const supabase = fakeSupabase({
      plan_events: [
        { source: "personal", reference: "p1", start_time: "09:00" },
        { source: "personal", reference: "p1", start_time: "09:30" },
        { source: "personal", reference: "p1", start_time: "10:00" },
      ],
      asana_tasks: [],
      personal_tasks: [{ id: "p1", name: "Renew passport" }],
    });
    expect(await detectMovePatterns(supabase, "user-1")).toEqual([]);
  });

  it("returns nothing with no moved events at all", async () => {
    const supabase = fakeSupabase({ plan_events: [], asana_tasks: [], personal_tasks: [] });
    expect(await detectMovePatterns(supabase, "user-1")).toEqual([]);
  });
});
