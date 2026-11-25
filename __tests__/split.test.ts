import { describe, expect, it } from "vitest";
import { splitHours } from "@/lib/split";

describe("splitHours", () => {
  it("conserves total hours exactly", () => {
    const result = splitHours(3.5, 1.5);
    expect(result).toEqual({ ok: true, firstHours: 1.5, remainderHours: 2 });
  });

  it("rejects zero or negative hours done", () => {
    expect(splitHours(3, 0)).toEqual({ ok: false, reason: expect.any(String) });
    expect(splitHours(3, -1)).toEqual({ ok: false, reason: expect.any(String) });
  });

  it("rejects hours-now at or above the total — nothing would be left to split off", () => {
    expect(splitHours(3, 3).ok).toBe(false);
    expect(splitHours(3, 4).ok).toBe(false);
  });

  it("rounds the remainder to avoid floating-point noise", () => {
    const result = splitHours(1, 0.1);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.remainderHours).toBe(0.9);
  });
});
