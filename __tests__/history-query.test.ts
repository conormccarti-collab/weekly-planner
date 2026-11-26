import { describe, expect, it, vi } from "vitest";
import { sumActualHours } from "@/lib/chat/history-query";

function fakeSupabase(rows: { hours: number | null; actual_hours: number | null }[]) {
  const builder: Record<string, unknown> = {};
  const chain = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    gte: vi.fn(() => builder),
    then: (resolve: (v: { data: typeof rows }) => void) => resolve({ data: rows }),
  };
  Object.assign(builder, chain);
  return { from: vi.fn(() => builder) } as never;
}

describe("sumActualHours", () => {
  it("prefers actual_hours over the planned hours when both are present", async () => {
    const supabase = fakeSupabase([{ hours: 3, actual_hours: 2 }]);
    const result = await sumActualHours(supabase, "user-1", "all", "2026-11-25");
    expect(result.hours).toBe(2);
    expect(result.blockCount).toBe(1);
  });

  it("falls back to planned hours when actual_hours is null", async () => {
    const supabase = fakeSupabase([{ hours: 3, actual_hours: null }]);
    const result = await sumActualHours(supabase, "user-1", "all", "2026-11-25");
    expect(result.hours).toBe(3);
  });

  it("sums across multiple rows", async () => {
    const supabase = fakeSupabase([
      { hours: 3, actual_hours: 2 },
      { hours: 1, actual_hours: 1.5 },
    ]);
    const result = await sumActualHours(supabase, "user-1", "all", "2026-11-25");
    expect(result.hours).toBe(3.5);
    expect(result.blockCount).toBe(2);
  });

  it("returns 0 with no rows", async () => {
    const supabase = fakeSupabase([]);
    const result = await sumActualHours(supabase, "user-1", "month", "2026-11-25");
    expect(result.hours).toBe(0);
    expect(result.blockCount).toBe(0);
  });
});
