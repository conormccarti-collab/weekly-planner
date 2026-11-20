import { describe, expect, it } from "vitest";
import { isCountedInTotals, provisionalHours, resolveEstimate } from "@/lib/estimates";

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

describe("provisionalHours", () => {
  it("passes through a real estimate unchanged, not provisional", () => {
    expect(provisionalHours({ hours: 6, origin: "default", label: "default" })).toEqual({ hours: 6, isProvisional: false });
  });

  it("gives a 1h provisional placeholder when there's no estimate at all", () => {
    expect(provisionalHours({ hours: null, origin: "none", label: "needs estimate" })).toEqual({ hours: 1, isProvisional: true });
  });

  it("defers to the one-tap picker instead when there are ambiguous options", () => {
    const ambiguousOptions = [{ variant: "producing", hours: 14 }];
    expect(provisionalHours({ hours: null, origin: "none", label: "needs estimate", ambiguousOptions })).toBeNull();
  });
});
