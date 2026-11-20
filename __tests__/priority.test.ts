import { describe, expect, it } from "vitest";
import { resolvePriority } from "@/lib/priority";

describe("resolvePriority", () => {
  it("uses the override when one is set", () => {
    expect(resolvePriority("High", "Low")).toBe("Low");
  });

  it("falls back to Asana's priority when there's no override", () => {
    expect(resolvePriority("High", null)).toBe("High");
  });

  it("is null when neither is set", () => {
    expect(resolvePriority(null, null)).toBeNull();
  });
});
