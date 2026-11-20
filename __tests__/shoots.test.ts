import { describe, expect, it } from "vitest";
import { expandShootDateSpan } from "@/lib/asana/shoots";

describe("expandShootDateSpan", () => {
  it("is just the due date when there's no start date", () => {
    expect(expandShootDateSpan(null, "2026-11-20")).toEqual(["2026-11-20"]);
  });

  it("is just the start date when there's no due date", () => {
    expect(expandShootDateSpan("2026-11-20", null)).toEqual(["2026-11-20"]);
  });

  it("is empty when neither date is present", () => {
    expect(expandShootDateSpan(null, null)).toEqual([]);
  });

  it("expands a multi-day span inclusively", () => {
    expect(expandShootDateSpan("2026-11-18", "2026-11-20")).toEqual(["2026-11-18", "2026-11-19", "2026-11-20"]);
  });

  it("is a single day when start equals due", () => {
    expect(expandShootDateSpan("2026-11-20", "2026-11-20")).toEqual(["2026-11-20"]);
  });

  it("falls back to just the due date when start is after due (bad data)", () => {
    expect(expandShootDateSpan("2026-11-25", "2026-11-20")).toEqual(["2026-11-20"]);
  });
});
