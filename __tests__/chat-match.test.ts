import { describe, expect, it } from "vitest";
import { findCandidateMatches } from "@/lib/chat/match";

const existing = [
  { source: "asana" as const, reference: "1", name: "Brian's 25th Trip - Edit", parentName: null },
  { source: "asana" as const, reference: "2", name: "W2W - 25th Anniversary Tartan", parentName: null },
  { source: "personal" as const, reference: "3", name: "Book the dentist", parentName: null },
];

describe("findCandidateMatches", () => {
  it("finds a clear word-overlap match", () => {
    const result = findCandidateMatches("finish the brian edit", existing);
    expect(result[0].reference).toBe("1");
    expect(result[0].score).toBeGreaterThan(0);
  });

  it("returns nothing for an unrelated line", () => {
    const result = findCandidateMatches("buy more coffee filters", existing);
    expect(result).toEqual([]);
  });

  it("ignores short common words when scoring", () => {
    const result = findCandidateMatches("the and for", existing);
    expect(result).toEqual([]);
  });

  it("is case and punctuation insensitive", () => {
    const result = findCandidateMatches("BRIAN'S 25TH TRIP!!", existing);
    expect(result[0].reference).toBe("1");
  });

  it("respects the limit option", () => {
    const result = findCandidateMatches("25th", existing, { limit: 1, minScore: 0 });
    expect(result).toHaveLength(1);
  });

  it("sorts best match first", () => {
    const result = findCandidateMatches("25th anniversary tartan edit", existing, { minScore: 0.1 });
    expect(result[0].reference).toBe("2");
  });
});

describe("findCandidateMatches — same-named stages across different deliverables", () => {
  // Live-reported bug: 12 real "Pre-Edit Review & Brief" tasks across
  // different deliverables, all with this exact bare name. Naming the
  // deliverable used to do nothing, since only bare `name` was matched.
  const sameStageName = [
    { source: "asana" as const, reference: "a", name: "Pre-Edit Review & Brief", parentName: "Tartan Design B2B" },
    { source: "asana" as const, reference: "b", name: "Pre-Edit Review & Brief", parentName: "W2W - 25th Anniversary Tartan" },
    { source: "asana" as const, reference: "c", name: "Pre-Edit Review & Brief", parentName: "Alex's Callanais Stones" },
  ];

  it("a query naming the deliverable ranks that one candidate above the identically-named others", () => {
    const result = findCandidateMatches("move the Tartan Design B2B pre-edit review and brief to friday", sameStageName, { minScore: 0.1 });
    expect(result[0].reference).toBe("a");
    expect(result[0].score).toBeGreaterThan(result.find((c) => c.reference === "c")?.score ?? Infinity);
  });

  it("a query naming no deliverable at all stays genuinely ambiguous — honest ambiguity, not a silent wrong guess", () => {
    // Different parentName token counts mean scores aren't always perfectly
    // tied (a longer deliverable name dilutes the Jaccard score slightly
    // more), but none of them is a real content match — the property that
    // actually matters is that this never collapses to one confident
    // candidate, which is what lets a caller auto-apply without asking.
    const result = findCandidateMatches("move the pre-edit review and brief to friday", sameStageName, { minScore: 0.1 });
    expect(result.length).toBeGreaterThan(1);
  });
});
