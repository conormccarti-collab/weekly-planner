import { daysBetweenDateStrs } from "@/lib/time";

/** v5 Stage 12d.4: a deliverable overdue by more than this is "Stale", not At risk. */
export const STALE_AFTER_DAYS = 14;

/**
 * "A task overdue by more than 14 days is Stale: not placed, not At risk,
 * listed once in a 'Needs a new date or closing' panel and in Hygiene.
 * Never silently dropped."
 */
export function isStale(dueOn: string | null, todayStr: string): boolean {
  if (dueOn == null) return false;
  return daysBetweenDateStrs(dueOn, todayStr) > STALE_AFTER_DAYS;
}
