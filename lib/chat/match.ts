/**
 * `parentName` is the deliverable a generically-named stage like
 * "Pre-Edit Review & Brief" belongs to — 12 different tasks in a real
 * account share that exact bare name. findCandidateMatches below folds it
 * into what it matches against (so "the Tartan edit" can actually tell
 * them apart), but lib/plan-pattern-learning.ts's own, separate call to
 * loadExistingTaskNames feeds detectStage the bare `name` directly and
 * must keep doing so — detectStage fuzzy-matches against a real stage
 * name ("Edit"), and a parent prefix would break that match entirely.
 */
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
 *
 * Live-reported bug: "move the Tartan Pre-Edit Review & Brief" matched
 * against bare `name` alone silently landed on a *different* deliverable's
 * identically-named "Pre-Edit Review & Brief" — "Tartan" never appeared in
 * any candidate's bare name, so it contributed nothing to the score, and a
 * three-way (really twelve-way) tie got cut to an arbitrary 3 by `.slice`,
 * auto-applying to whichever happened to land as the sole survivor. Folding
 * `parentName` into the candidate text fixes the case that actually
 * matters — a query that names the deliverable now scores that candidate
 * higher instead of tying with every other same-named stage. It doesn't
 * fully solve a query that names *no* deliverable at all: with several
 * same-named candidates still tied, `limit` can still arbitrarily cut
 * which ones are offered — a known, lesser residual gap, left alone here
 * since `limit` is also relied on elsewhere (e.g. the Monday-list
 * best-guess link) to mean a hard cap, not "every tied candidate."
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
    .map((e) => ({ ...e, score: jaccard(lineTokens, tokenize(e.parentName ? `${e.parentName} ${e.name}` : e.name)) }))
    .filter((c) => c.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
