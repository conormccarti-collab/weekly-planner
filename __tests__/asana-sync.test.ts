import { describe, expect, it } from "vitest";
import { mergeCustomFields } from "@/lib/asana/sync";

describe("mergeCustomFields", () => {
  it("v5 Stage 12e.4 fix: a subtask's own explicit null never overwrites the parent's real value — the actual bug behind 'Brand/Video Type inheritance is broken'", () => {
    // Asana always returns every workspace custom field on every task, even
    // unset — customFieldsToMap's output always has these keys as explicit
    // null, not simply absent. A plain {...parent, ...own} spread can't
    // tell that apart from "deliberately cleared" and always lets it win.
    const parent = { Brand: "Scotland", Priority: null, "Video Type": "Youtube Narrative" };
    const ownUnset = { Brand: null, Priority: null, "Video Type": null };
    expect(mergeCustomFields(parent, ownUnset)).toEqual({ Brand: "Scotland", Priority: null, "Video Type": "Youtube Narrative" });
  });

  it("still lets the subtask's own real value take precedence when it actually has one", () => {
    const parent = { Brand: "Scotland", "Video Type": "Youtube Narrative" };
    const own = { Brand: "WPT", "Video Type": null };
    expect(mergeCustomFields(parent, own)).toEqual({ Brand: "WPT", "Video Type": "Youtube Narrative" });
  });

  it("adds a field the parent never had", () => {
    expect(mergeCustomFields({ Brand: "Scotland" }, { Priority: "High" })).toEqual({ Brand: "Scotland", Priority: "High" });
  });

  it("is empty-safe in both directions", () => {
    expect(mergeCustomFields({}, { Brand: "Scotland" })).toEqual({ Brand: "Scotland" });
    expect(mergeCustomFields({ Brand: "Scotland" }, {})).toEqual({ Brand: "Scotland" });
  });
});
