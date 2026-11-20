import { addDaysToDateStr, utcInstantToLocal } from "@/lib/time";
import type { GoogleCalendarEvent } from "./types";

/** Brief section 7: "An event reduces capacity unless it is declined or marked 'free'." */
export function isEventBusy(event: GoogleCalendarEvent): boolean {
  if (event.status === "cancelled") return false;
  if (event.transparency === "transparent") return false;

  const self = event.attendees?.find((a) => a.self);
  if (self?.responseStatus === "declined") return false;

  return true;
}

export function isAllDayEvent(event: GoogleCalendarEvent): boolean {
  return !!event.start?.date && !event.start?.dateTime;
}

/**
 * Google's "Out of Office" event type represents a full day (or multi-day
 * span) of unavailability, but — unlike a true all-day event — it's stored
 * with timed `dateTime` fields, not date-only `date` fields. Treated the
 * same as an all-day busy event: it blocks the whole day regardless of the
 * specific hours it spans.
 */
export function isOutOfOffice(event: GoogleCalendarEvent): boolean {
  return event.eventType === "outOfOffice";
}

/**
 * The date-only span [startDate, endDateExclusive) a full-day event blocks,
 * for either a true all-day event (date-only fields, end already exclusive)
 * or an Out of Office event (timed fields representing the same thing).
 * Returns null if the event has neither shape.
 */
export function fullDaySpan(
  event: GoogleCalendarEvent,
  timezone: string
): { startDate: string; endDateExclusive: string } | null {
  if (event.start?.date && event.end?.date) {
    return { startDate: event.start.date, endDateExclusive: event.end.date };
  }
  if (event.start?.dateTime && event.end?.dateTime) {
    const start = utcInstantToLocal(new Date(event.start.dateTime), timezone);
    const end = utcInstantToLocal(new Date(event.end.dateTime), timezone);
    const endDateExclusive =
      end.minutesFromMidnight === 0 ? end.dateStr : addDaysToDateStr(end.dateStr, 1);
    return { startDate: start.dateStr, endDateExclusive };
  }
  return null;
}
