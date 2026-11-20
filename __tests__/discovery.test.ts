import { describe, expect, it } from "vitest";
import { seriesNameOf, groupBySeries } from "@/lib/asana/discovery";

describe("seriesNameOf", () => {
  it("extracts the series name from a batch task", () => {
    expect(seriesNameOf("Highland Education: Batch 1")).toBe("Highland Education");
  });

  it("extracts the series name from an episode task", () => {
    expect(seriesNameOf("Highland Education: Ep 3")).toBe("Highland Education");
  });

  it("is case-insensitive on Batch/Ep", () => {
    expect(seriesNameOf("Highland Education: batch 2")).toBe("Highland Education");
    expect(seriesNameOf("Highland Education: ep 12")).toBe("Highland Education");
  });

  it("is null for an ordinary deliverable name", () => {
    expect(seriesNameOf("Update video guidelines")).toBeNull();
  });

  it("is null when the colon is present but not followed by Batch/Ep N", () => {
    expect(seriesNameOf("Highland Education: Review")).toBeNull();
  });

  it("trims whitespace around the series name", () => {
    expect(seriesNameOf("  Highland Education  :  Batch 1")).toBe("Highland Education");
  });
});

type Fixture = { name: string };

describe("groupBySeries", () => {
  // Brief section 8's "done when": a test series with one batch and three
  // episodes shows grouped, everything else stays standalone.
  it("groups a batch with its three episodes under one series heading, leaving an ordinary deliverable standalone", () => {
    const items: Fixture[] = [
      { name: "Highland Education: Batch 1" },
      { name: "Highland Education: Ep 1" },
      { name: "Highland Education: Ep 2" },
      { name: "Highland Education: Ep 3" },
      { name: "Update video guidelines" },
    ];
    const { series, standalone } = groupBySeries(items, (i) => seriesNameOf(i.name));

    expect(series).toHaveLength(1);
    expect(series[0].seriesName).toBe("Highland Education");
    expect(series[0].items.map((i) => i.name)).toEqual([
      "Highland Education: Batch 1",
      "Highland Education: Ep 1",
      "Highland Education: Ep 2",
      "Highland Education: Ep 3",
    ]);
    expect(standalone.map((i) => i.name)).toEqual(["Update video guidelines"]);
  });

  it("groups two independent series separately, sorted by series name", () => {
    const items: Fixture[] = [
      { name: "Zion Trails: Batch 1" },
      { name: "Achpopui Farm: Batch 1" },
      { name: "Achpopui Farm: Ep 1" },
    ];
    const { series } = groupBySeries(items, (i) => seriesNameOf(i.name));
    expect(series.map((s) => s.seriesName)).toEqual(["Achpopui Farm", "Zion Trails"]);
  });

  it("is all standalone when nothing matches the series pattern", () => {
    const items: Fixture[] = [{ name: "A" }, { name: "B" }];
    const { series, standalone } = groupBySeries(items, (i) => seriesNameOf(i.name));
    expect(series).toEqual([]);
    expect(standalone).toHaveLength(2);
  });
});
