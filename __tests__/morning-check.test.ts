import { describe, expect, it } from "vitest";
import { resolveMorningCheckUpdate } from "@/lib/morning-check";

describe("resolveMorningCheckUpdate", () => {
  it("Done assumes it took exactly the planned time", () => {
    expect(resolveMorningCheckUpdate("done", 3.5, null)).toEqual({
      status: "done",
      actualHours: 3.5,
      remainingHours: null,
    });
  });

  it("On track leaves the block as planned, no actual hours recorded yet", () => {
    expect(resolveMorningCheckUpdate("on_track", 3.5, null)).toEqual({
      status: "planned",
      actualHours: null,
      remainingHours: null,
    });
  });

  it("Behind records hours spent so far and hours left", () => {
    expect(resolveMorningCheckUpdate("behind", 3.5, 2)).toEqual({
      status: "behind",
      actualHours: 1.5,
      remainingHours: 2,
    });
  });

  it("Behind never reports negative hours spent if hours left exceeds the plan", () => {
    expect(resolveMorningCheckUpdate("behind", 2, 5)).toEqual({
      status: "behind",
      actualHours: 0,
      remainingHours: 5,
    });
  });

  it("Behind with no hours-left answer assumes nothing was done yet", () => {
    expect(resolveMorningCheckUpdate("behind", 3.5, null)).toEqual({
      status: "behind",
      actualHours: 0,
      remainingHours: 3.5,
    });
  });
});
