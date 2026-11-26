import { describe, expect, it } from "vitest";
import { brandColorsFor, officeAccentFor, OFFICES } from "@/lib/brand-colors";

describe("brandColorsFor", () => {
  it("matches a known brand case-insensitively and trimmed", () => {
    expect(brandColorsFor("  Scotland  ")).toEqual({ label: "Scotland", tint: "#1C2A33", edge: "#5FA3DB" });
    expect(brandColorsFor("WPT")).toEqual({ label: "WPT", tint: "#2A2233", edge: "#B896E0" });
  });

  it("falls back to the dashed no-brand style for null or an unknown value", () => {
    const noBrand = { label: "No brand", tint: "#1E2926", edge: "#93A39C", dashed: true };
    expect(brandColorsFor(null)).toEqual(noBrand);
    expect(brandColorsFor("Nonsense")).toEqual(noBrand);
  });
});

describe("officeAccentFor", () => {
  it("returns an accent + on-accent pair for every listed office", () => {
    for (const office of OFFICES) {
      const result = officeAccentFor(office);
      expect(result).not.toBeNull();
      expect(result!.onAccent).toBe("#0C1C15");
    }
  });

  it("matches the brand table's edge colour, case-insensitively", () => {
    expect(officeAccentFor("scotland")).toEqual({ accent: "#5FA3DB", onAccent: "#0C1C15" });
  });

  it("returns null for no selection or an unrecognised value", () => {
    expect(officeAccentFor(null)).toBeNull();
    expect(officeAccentFor("Nonsense")).toBeNull();
  });
});
