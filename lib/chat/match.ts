/** `parentName` is display-only (the deliverable a generically-named stage like "Pre-Edit Review & Brief" belongs to) — matching and detectStage both deliberately keep using bare `name`, never this. */
export type ExistingTaskName = { source: "asana" | "personal"; reference: string; name: string; parentName: string | null };
export type MatchCandidate = ExistingTaskName & { score: number };

function normalize(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/'s\b/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ");
}

function tokenize(s: string): Set<string> {
  return new Set(normalize(s).split(" ").filter((w) => w.length > 2));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const w of a) if (b.has(w)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Brief section 9: "Code supplies likely matches from existing Asana and
 * personal tasks" for a Monday-list line — the model then decides whether a
 * supplied candidate is a clear match, never inventing matches of its own.
 */
export function findCandidateMatches(
  lineText: string,
  existing: ExistingTaskName[],
  options?: { limit?: number; minScore?: number }
): MatchCandidate[] {
  const limit = options?.limit ?? 3;
  const minScore = options?.minScore ?? 0.3;
  const lineTokens = tokenize(lineText);

  return existing
    .map((e) => ({ ...e, score: jaccard(lineTokens, tokenize(e.name)) }))
    .filter((c) => c.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
