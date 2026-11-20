import { describe, expect, it } from "vitest";
import { detectStage, resolveReviewFocus, STAGE_FOCUS, STAGES } from "@/lib/asana/stage";

describe("detectStage", () => {
  it("recognises each canonical stage name exactly", () => {
    for (const stage of STAGES) {
      expect(detectStage(stage)).toBe(stage);
    }
  });

  it("recognises the brief's exact messy real-world examples", () => {
    expect(detectStage("Planning &Pre-Production")).toBe("Planning & Pre-Production");
    expect(detectStage("Planning & Pre Production")).toBe("Planning & Pre-Production");
    expect(detectStage("Pre-Edit Revire & Brief")).toBe("Pre-Edit Review & Brief");
    expect(detectStage("Pre-edit Review & Brief")).toBe("Pre-Edit Review & Brief");
  });

  it("maps legacy Ideation and Script names to Creative Brief (v1.3)", () => {
    expect(detectStage("Ideation")).toBe("Creative Brief");
    expect(detectStage("Script")).toBe("Creative Brief");
    expect(detectStage("ideation")).toBe("Creative Brief");
  });

  it("ignores case and extra spacing", () => {
    expect(detectStage("EDIT")).toBe("Edit");
    expect(detectStage("  edit  ")).toBe("Edit");
    expect(detectStage("creative brief")).toBe("Creative Brief");
  });

  it("recognises a bare Shoot and every numbered/suffixed real-world variant", () => {
    expect(detectStage("Shoot")).toBe("Shoot");
    expect(detectStage("Shoot 1 - England")).toBe("Shoot");
    expect(detectStage("Shoot 2 - Mill")).toBe("Shoot");
    expect(detectStage("Shoot: Mill")).toBe("Shoot");
  });

  it("does not match a container or unrelated task name to any stage", () => {
    expect(detectStage("2026 Bike Fleet Video")).toBeNull();
    expect(detectStage("V1 Editing party begins - Pick up footage from NAS")).toBeNull();
    expect(detectStage("1:1")).toBeNull();
    // Shoehorning anything starting with "Shoot" is deliberate, but a task
    // that merely mentions shooting mid-sentence should not match.
    expect(detectStage("Schedule filming days")).toBeNull();
  });

  it("recognises the new v1.3 stages", () => {
    expect(detectStage("Revisions")).toBe("Revisions");
    expect(detectStage("Shorts")).toBe("Shorts");
    expect(detectStage("Archive")).toBe("Archive");
  });

  it("recognises a stage name standing alone as the whole subtask name", () => {
    expect(detectStage("Publish")).toBe("Publish");
    expect(detectStage("Review")).toBe("Review");
  });
});

describe("STAGE_FOCUS", () => {
  it("matches v1.3's table for each stage with a fixed focus", () => {
    expect(STAGE_FOCUS["Creative Brief"]).toBe("shallow");
    expect(STAGE_FOCUS["Planning & Pre-Production"]).toBe("shallow");
    expect(STAGE_FOCUS.Shoot).toBe("away");
    expect(STAGE_FOCUS["Pre-Edit Review & Brief"]).toBe("deep");
    expect(STAGE_FOCUS.Edit).toBe("deep");
    expect(STAGE_FOCUS.Revisions).toBe("deep");
    expect(STAGE_FOCUS.Shorts).toBe("shallow");
    expect(STAGE_FOCUS.Publish).toBe("shallow");
    expect(STAGE_FOCUS.Archive).toBe("shallow");
  });
});

describe("resolveReviewFocus", () => {
  it("is a 48-hour wait (no desk hours) when the user is the editor", () => {
    expect(resolveReviewFocus(true)).toBe("waiting");
  });

  it("is a short shallow task when reviewing someone else's edit", () => {
    expect(resolveReviewFocus(false)).toBe("shallow");
  });
});
