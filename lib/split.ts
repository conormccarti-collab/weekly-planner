/**
 * v5 brief Stage 13b.1: "A Split action on any block: choose the hours for
 * the first part, the rest becomes part two... Total hours are conserved."
 * Pure validation + arithmetic — the actual DB/placement work lives in
 * `splitBlock` (app/(app)/plan/actions.ts), which calls this first.
 */
export type SplitResult =
  | { ok: true; firstHours: number; remainderHours: number }
  | { ok: false; reason: string };

export function splitHours(totalHours: number, hoursNow: number): SplitResult {
  if (!(hoursNow > 0)) {
    return { ok: false, reason: "Enter the hours done so far." };
  }
  if (hoursNow >= totalHours) {
    return { ok: false, reason: `That's the whole task (${totalHours}h) — nothing would be left to split off.` };
  }
  const remainderHours = Math.round((totalHours - hoursNow) * 100) / 100;
  return { ok: true, firstHours: hoursNow, remainderHours };
}
