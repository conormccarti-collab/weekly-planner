import { describe, expect, it } from "vitest";
import { isCountedInTotals, placementHours, resolveEstimate } from "@/lib/estimates";

const ALL_NULL = { userHours: null, learnedHours: null, defaultHours: null, suggestedHours: null };

describe("resolveEstimate", () => {
  it("prefers the user's own figure over everything else", () => {
    const result = resolveEstimate({ ...ALL_NULL, userHours: 10, learnedHours: 8, defaultHours: 6, suggestedHours: 4 });
    expect(result).toEqual({ hours: 10, origin: "user", label: "your estimate" });
  });

  it("falls back to a learned figure when there's no user figure", () => {
    const result = resolveEstimate({ ...ALL_NULL, learnedHours: 8, defaultHours: 6, suggestedHours: 4 });
    expect(result).toEqual({ hours: 8, origin: "learned", label: "from your earlier entry" });
  });

  it("falls back to the content-type/stage default next", () => {
    const result = resolveEstimate({ ...ALL_NULL, defaultHours: 6, suggestedHours: 4 });
    expect(result).toEqual({ hours: 6, origin: "default", label: "default" });
  });

  it("falls back to a model suggestion last", () => {
    const result = resolveEstimate({ ...ALL_NULL, suggestedHours: 4 });
    expect(result).toEqual({ hours: 4, origin: "suggested", label: "suggested" });
  });

  it("is 'needs estimate' when nothing is available", () => {
    const result = resolveEstimate(ALL_NULL);
    expect(result).toEqual({ hours: null, origin: "none", label: "needs estimate" });
  });

  it("a zero-hour user estimate is still respected (not treated as missing)", () => {
    const result = resolveEstimate({ ...ALL_NULL, userHours: 0 });
    expect(result).toEqual({ hours: 0, origin: "user", label: "your estimate" });
  });

  it("surfaces ambiguous default candidates instead of silently picking none", () => {
    const ambiguousDefaults = [
      { variant: "producing", hours: 14 },
      { variant: "overseeing", hours: 3.5 },
    ];
    const result = resolveEstimate({ ...ALL_NULL, ambiguousDefaults });
    expect(result).toEqual({ hours: null, origin: "none", label: "needs estimate", ambiguousOptions: ambiguousDefaults });
  });

  it("a user figure still wins over ambiguous defaults", () => {
    const ambiguousDefaults = [{ variant: "producing", hours: 14 }, { variant: "overseeing", hours: 3.5 }];
    const result = resolveEstimate({ ...ALL_NULL, userHours: 10, ambiguousDefaults });
    expect(result).toEqual({ hours: 10, origin: "user", label: "your estimate" });
  });
});

describe("isCountedInTotals", () => {
  it("counts user, learned and default estimates", () => {
    expect(isCountedInTotals("user")).toBe(true);
    expect(isCountedInTotals("learned")).toBe(true);
    expect(isCountedInTotals("default")).toBe(true);
  });

  it("excludes an unconfirmed suggestion and a missing estimate", () => {
    expect(isCountedInTotals("suggested")).toBe(false);
    expect(isCountedInTotals("none")).toBe(false);
  });
});

describe("placementHours", () => {
  it("passes through a confirmed estimate as not suggested", () => {
    expect(placementHours({ hours: 6, origin: "default", label: "default" })).toEqual({ hours: 6, isSuggested: false });
  });

  it("flags a model-suggested estimate for placement, excluded from totals downstream", () => {
    expect(placementHours({ hours: 4, origin: "suggested", label: "suggested" })).toEqual({ hours: 4, isSuggested: true });
  });

  it("is null (don't place) when there's no estimate at all, even from the model", () => {
    expect(placementHours({ hours: null, origin: "none", label: "needs estimate" })).toBeNull();
  });

  it("is null when there are ambiguous options to pick from instead", () => {
    const ambiguousOptions = [{ variant: "producing", hours: 14 }];
    expect(placementHours({ hours: null, origin: "none", label: "needs estimate", ambiguousOptions })).toBeNull();
  });
});
