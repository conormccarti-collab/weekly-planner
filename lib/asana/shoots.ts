import { addDaysToDateStr } from "@/lib/time";

export type ShootMarker = {
  gid: string;
  name: string;
  dateStr: string;
  shootType: string | null;
  location: string | null;
};

const MAX_SPAN_DAYS = 60;

/**
 * v2 (18 Nov 2026), item B.9: show a shoot on its due date, or across the
 * span if it also has a start date. Guards against a reversed or
 * unreasonably long span from bad data rather than looping forever.
 */
export function expandShootDateSpan(startOn: string | null, dueOn: string | null): string[] {
  if (!dueOn && !startOn) return [];

  const end = dueOn ?? startOn!;
  const start = startOn ?? end;
  if (start > end) return [end];

  const dates: string[] = [];
  let cursor = start;
  for (let i = 0; i < MAX_SPAN_DAYS && cursor <= end; i++) {
    dates.push(cursor);
    cursor = addDaysToDateStr(cursor, 1);
  }
  return dates;
}
