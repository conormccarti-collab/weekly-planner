export type GoogleCalendarEvent = {
  id: string;
  summary?: string;
  status?: string; // "confirmed" | "tentative" | "cancelled"
  transparency?: string; // "opaque" (busy, default) | "transparent" (free)
  eventType?: string; // "default" | "outOfOffice" | "focusTime" | ...
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  attendees?: { self?: boolean; responseStatus?: string }[];
};
