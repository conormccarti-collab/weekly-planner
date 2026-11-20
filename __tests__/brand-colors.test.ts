import { describe, expect, it } from "vitest";
import { brandColorsFor, officeAccentFor, OFFICES } from "@/lib/brand-colors";

describe("brandColorsFor", () => {
  it("matches a known brand case-insensitively and trimmed", () => {
    expect(brandColorsFor("  Scotland  ")).toEqual({ label: "Scotland", tint: "#353A42", edge: "#8B90C1" });
    expect(brandColorsFor("WPT")).toEqual({ label: "WPT", tint: "#323839", edge: "#BE9E61" });
  });

  it("falls back to the dashed no-brand style for null or an unknown value", () => {
    const noBrand = { label: "No brand", tint: "#303634", edge: "#787F7C", dashed: true };
    expect(brandColorsFor(null)).toEqual(noBrand);
    expect(brandColorsFor("Nonsense")).toEqual(noBrand);
  });
});

describe("officeAccentFor", () => {
  it("returns an accent + on-accent pair for every listed office", () => {
    for (const office of OFFICES) {
      const result = officeAccentFor(office);
      expect(result).not.toBeNull();
      expect(result!.onAccent).toBe("#1D1D1D");
    }
  });

  it("matches the brand table's edge colour, case-insensitively", () => {
    expect(officeAccentFor("scotland")).toEqual({ accent: "#8B90C1", onAccent: "#1D1D1D" });
  });

  it("returns null for no selection or an unrecognised value", () => {
    expect(officeAccentFor(null)).toBeNull();
    expect(officeAccentFor("Nonsense")).toBeNull();
  });
});
