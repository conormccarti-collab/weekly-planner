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
 * higher instead of tying with every other same-named stage.
 *
 * `includeTies`: when a query names *no* deliverable at all, several
 * same-named candidates can still tie — the caller always ends up asking
 * rather than guessing (candidates.length is never 1 in that case), but
 * the plain `limit` cutoff below would arbitrarily show only `limit` of
 * however many are tied, possibly missing the one actually meant from the
 * picker. Every chat disambiguation call site passes this; the one
 * exception is the Monday-list's own best-guess link, which deliberately
 * wants `limit` to mean a hard cap on how many candidates to suggest, not
 * "every tied one."
 */
export function findCandidateMatches(
  lineText: string,
  existing: ExistingTaskName[],
  options?: { limit?: number; minScore?: number; includeTies?: boolean }
): MatchCandidate[] {
  const limit = options?.limit ?? 3;
  const minScore = options?.minScore ?? 0.3;
  const lineTokens = tokenize(lineText);

  const scored = existing
    .map((e) => ({ ...e, score: jaccard(lineTokens, tokenize(e.parentName ? `${e.parentName} ${e.name}` : e.name)) }))
    .filter((c) => c.score >= minScore)
    .sort((a, b) => b.score - a.score);

  if (options?.includeTies && scored.length > limit) {
    const cutoffScore = scored[limit - 1].score;
    const lastIndexAtCutoff = scored.findIndex((c) => c.score < cutoffScore);
    return scored.slice(0, lastIndexAtCutoff === -1 ? scored.length : lastIndexAtCutoff);
  }
  return scored.slice(0, limit);
}
