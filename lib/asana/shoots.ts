import { addDaysToDateStr } from "@/lib/time";

export type ShootMarker = {
  gid: string;
  name: string;
  dateStr: string;
  shootType: string | null;
  location: string | null;
  /** v4 Stage 4a, brief 7.4a: whether a calendar event was matched for this shoot's date span. */
  matchedEventTitle: string | null;
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

export type CalendarEventForMatch = {
  title: string;
  allDay: boolean;
  startDate: string | null;
  endDate: string | null;
  /** ISO instant — only meaningful for a non-all-day event. */
  startsAt: string | null;
  busy: boolean;
  responseStatus: string | null;
};

const STOP_WORDS = new Set(["the", "and", "for", "with", "shoot", "shoots", "a", "of", "in", "on", "at", "to", "day"]);

function distinctiveWords(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !STOP_WORDS.has(w))
  );
}

/**
 * v4 Stage 4a, brief 7.4a: "A match is an all-day or multi-day busy event,
 * or a timed event whose title shares a distinctive word with the shoot
 * name." Read-only — this only reports a match, it never creates or edits
 * a calendar event (brief: "Never create or edit a calendar event").
 */
export function matchShootToCalendarEvent(
  shootName: string,
  dateSpan: string[],
  events: CalendarEventForMatch[]
): CalendarEventForMatch | null {
  const spanSet = new Set(dateSpan);
  const shootWords = distinctiveWords(shootName);

  for (const event of events) {
    if (!event.busy || event.responseStatus === "declined") continue;

    if (event.allDay) {
      if (event.startDate && event.endDate && dateSpan.some((d) => d >= event.startDate! && d <= event.endDate!)) {
        return event;
      }
      continue;
    }

    if (!event.startsAt) continue;
    const eventDate = event.startsAt.slice(0, 10);
    if (!spanSet.has(eventDate)) continue;
    const eventWords = distinctiveWords(event.title);
    if ([...shootWords].some((w) => eventWords.has(w))) return event;
  }

  return null;
}
