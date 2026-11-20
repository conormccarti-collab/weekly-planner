import { createHash } from "crypto";

/**
 * v5 Stage 12c: a deterministic fingerprint of whatever raw data a build
 * depends on, so `refreshDraftWeek` can skip the rebuild (and its write)
 * entirely when nothing has changed since the last one. Object key order
 * never matters; array element order does — callers must sort any array
 * whose source (a Supabase query) doesn't guarantee stable ordering before
 * passing it in.
 */
export function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(sortKeysDeep(value))).digest("hex");
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    const sorted: Record<string, unknown> = {};
    for (const [k, v] of entries) sorted[k] = sortKeysDeep(v);
    return sorted;
  }
  return value;
}
