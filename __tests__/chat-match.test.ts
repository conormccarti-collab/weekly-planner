import { describe, expect, it } from "vitest";
import { findCandidateMatches } from "@/lib/chat/match";

const existing = [
  { source: "asana" as const, reference: "1", name: "Brian's 25th Trip - Edit" },
  { source: "asana" as const, reference: "2", name: "W2W - 25th Anniversary Tartan" },
  { source: "personal" as const, reference: "3", name: "Book the dentist" },
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
