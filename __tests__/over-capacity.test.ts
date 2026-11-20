import { describe, expect, it } from "vitest";
import { proposeOverCapacityMoves } from "@/lib/over-capacity";
import type { AutoPlaceCandidate } from "@/lib/auto-placement";

function candidate(overrides: Partial<AutoPlaceCandidate> & { reference: string }): AutoPlaceCandidate {
  return {
    source: "asana",
    rootRef: overrides.reference,
    stageOrder: 0,
    must: false,
    hasHardDeadline: false,
    dueOn: null,
    priority: null,
    focusType: "shallow",
    estimateHours: 1,
    ...overrides,
  };
}

describe("proposeOverCapacityMoves", () => {
  it("proposes nothing when the week fits within capacity", () => {
    const result = proposeOverCapacityMoves([candidate({ reference: "a", estimateHours: 5 })], 7);
    expect(result).toEqual({ overCapacityHours: 0, toMove: [] });
  });

  it("proposes the lowest-ranked task first when over capacity", () => {
    const result = proposeOverCapacityMoves(
      [
        candidate({ reference: "high", priority: "High", estimateHours: 4 }),
        candidate({ reference: "low", priority: "Low", estimateHours: 4 }),
      ],
      7
    );
    expect(result.overCapacityHours).toBe(1);
    expect(result.toMove.map((c) => c.reference)).toEqual(["low"]);
  });

  it("never proposes moving a Must task, even if it's the lowest-ranked", () => {
    const result = proposeOverCapacityMoves(
      [
        candidate({ reference: "must-low", priority: "Low", must: true, estimateHours: 4 }),
        candidate({ reference: "high", priority: "High", estimateHours: 4 }),
      ],
      7
    );
    // Only "high" is eligible to move since "must-low" is a Must.
    expect(result.toMove.map((c) => c.reference)).toEqual(["high"]);
  });

  it("proposes multiple tasks if one alone doesn't clear the overage", () => {
    const result = proposeOverCapacityMoves(
      [
        candidate({ reference: "a", priority: "High", estimateHours: 3 }),
        candidate({ reference: "b", priority: "Medium", estimateHours: 3 }),
        candidate({ reference: "c", priority: "Low", estimateHours: 3 }),
      ],
      7
    );
    expect(result.overCapacityHours).toBe(2);
    // "c" (Low) alone clears 3h >= 2h needed, so it stops there.
    expect(result.toMove.map((c) => c.reference)).toEqual(["c"]);
  });

  it("does the best it can when even every non-Must task isn't enough", () => {
    const result = proposeOverCapacityMoves(
      [
        candidate({ reference: "must", must: true, estimateHours: 10 }),
        candidate({ reference: "other", estimateHours: 1 }),
      ],
      7
    );
    expect(result.overCapacityHours).toBe(4);
    expect(result.toMove.map((c) => c.reference)).toEqual(["other"]);
  });
});
