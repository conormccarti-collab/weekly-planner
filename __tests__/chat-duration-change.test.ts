import { describe, expect, it } from "vitest";
import { resolveNewDurationMinutes } from "@/lib/chat/duration-change";

describe("resolveNewDurationMinutes", () => {
  it("keeps the old duration when neither an absolute nor a relative change is given", () => {
    expect(resolveNewDurationMinutes(60, null, null)).toBe(60);
  });

  it("uses the absolute total when one is given", () => {
    expect(resolveNewDurationMinutes(60, 3, null)).toBe(180);
  });

  it("adds a positive delta to the real current duration — 'give it another hour'", () => {
    expect(resolveNewDurationMinutes(60, null, 1)).toBe(120);
  });

  it("subtracts a negative delta — 'half an hour less'", () => {
    expect(resolveNewDurationMinutes(120, null, -0.5)).toBe(90);
  });

  it("prefers the absolute figure over a delta if the model somehow sends both", () => {
    expect(resolveNewDurationMinutes(60, 4, 1)).toBe(240);
  });
});
