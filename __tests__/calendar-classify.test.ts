import { describe, expect, it } from "vitest";
import { fullDaySpan, isAllDayEvent, isEventBusy, isOutOfOffice } from "@/lib/calendar/classify";

const LONDON = "Europe/London";

describe("isEventBusy", () => {
  it("a normal confirmed event is busy", () => {
    expect(isEventBusy({ id: "1", status: "confirmed" })).toBe(true);
  });

  it("a cancelled event is not busy", () => {
    expect(isEventBusy({ id: "1", status: "cancelled" })).toBe(false);
  });

  it("an event marked 'free' (transparent) is not busy", () => {
    expect(isEventBusy({ id: "1", transparency: "transparent" })).toBe(false);
  });

  it("a meeting the user declined is not busy", () => {
    expect(
      isEventBusy({
        id: "1",
        attendees: [{ self: true, responseStatus: "declined" }],
      })
    ).toBe(false);
  });

  it("a meeting the user accepted is busy", () => {
    expect(
      isEventBusy({
        id: "1",
        attendees: [{ self: true, responseStatus: "accepted" }],
      })
    ).toBe(true);
  });
});

describe("isAllDayEvent", () => {
  it("an event with a date-only start is all-day", () => {
    expect(isAllDayEvent({ id: "1", start: { date: "2026-11-17" } })).toBe(true);
  });

  it("an event with a dateTime start is not all-day", () => {
    expect(
      isAllDayEvent({ id: "1", start: { dateTime: "2026-11-17T09:00:00Z" } })
    ).toBe(false);
  });
});

describe("isOutOfOffice", () => {
  it("an Out of Office event is identified even though it uses dateTime, not date", () => {
    expect(
      isOutOfOffice({
        id: "1",
        eventType: "outOfOffice",
        start: { dateTime: "2026-11-14T00:00:00Z" },
        end: { dateTime: "2026-11-21T00:00:00Z" },
      })
    ).toBe(true);
  });

  it("a normal event is not Out of Office", () => {
    expect(isOutOfOffice({ id: "1", status: "confirmed" })).toBe(false);
  });
});

describe("fullDaySpan", () => {
  it("uses date-only fields directly, end already exclusive", () => {
    expect(
      fullDaySpan({ id: "1", start: { date: "2026-11-17" }, end: { date: "2026-11-18" } }, LONDON)
    ).toEqual({ startDate: "2026-11-17", endDateExclusive: "2026-11-18" });
  });

  it("converts an Out of Office event's dateTime span, midnight-to-midnight", () => {
    // A week-long OOO, Nov 14 00:00 GMT to Nov 21 00:00 GMT (London is UTC+0 in Nov)
    expect(
      fullDaySpan(
        { id: "1", start: { dateTime: "2026-11-14T00:00:00Z" }, end: { dateTime: "2026-11-21T00:00:00Z" } },
        LONDON
      )
    ).toEqual({ startDate: "2026-11-14", endDateExclusive: "2026-11-21" });
  });

  it("rounds a non-midnight end up to the next day, so the last day stays included", () => {
    // OOO ending at 17:00 on the 21st should still block the 21st itself
    expect(
      fullDaySpan(
        { id: "1", start: { dateTime: "2026-11-14T00:00:00Z" }, end: { dateTime: "2026-11-21T17:00:00Z" } },
        LONDON
      )
    ).toEqual({ startDate: "2026-11-14", endDateExclusive: "2026-11-22" });
  });

  it("returns null when the event has neither date nor dateTime fields", () => {
    expect(fullDaySpan({ id: "1" }, LONDON)).toBeNull();
  });
});
