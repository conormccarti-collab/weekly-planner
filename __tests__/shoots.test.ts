import { describe, expect, it } from "vitest";
import { expandShootDateSpan, matchShootToCalendarEvent, type CalendarEventForMatch } from "@/lib/asana/shoots";

describe("expandShootDateSpan", () => {
  it("is just the due date when there's no start date", () => {
    expect(expandShootDateSpan(null, "2026-11-20")).toEqual(["2026-11-20"]);
  });

  it("is just the start date when there's no due date", () => {
    expect(expandShootDateSpan("2026-11-20", null)).toEqual(["2026-11-20"]);
  });

  it("is empty when neither date is present", () => {
    expect(expandShootDateSpan(null, null)).toEqual([]);
  });

  it("expands a multi-day span inclusively", () => {
    expect(expandShootDateSpan("2026-11-18", "2026-11-20")).toEqual(["2026-11-18", "2026-11-19", "2026-11-20"]);
  });

  it("is a single day when start equals due", () => {
    expect(expandShootDateSpan("2026-11-20", "2026-11-20")).toEqual(["2026-11-20"]);
  });

  it("falls back to just the due date when start is after due (bad data)", () => {
    expect(expandShootDateSpan("2026-11-25", "2026-11-20")).toEqual(["2026-11-20"]);
  });
});

function event(overrides: Partial<CalendarEventForMatch>): CalendarEventForMatch {
  return { title: "Event", allDay: false, startDate: null, endDate: null, startsAt: null, busy: true, responseStatus: null, ...overrides };
}

describe("matchShootToCalendarEvent", () => {
  it("matches an all-day event overlapping the shoot's span, with no title check needed", () => {
    const e = event({ allDay: true, startDate: "2026-11-18", endDate: "2026-11-20", title: "Out of office" });
    expect(matchShootToCalendarEvent("Shoot 1 - Glenfinnan", ["2026-11-19"], [e])).toBe(e);
  });

  it("matches a timed event sharing a distinctive word on the right date", () => {
    const e = event({ startsAt: "2026-11-20T09:00:00Z", title: "Glenfinnan recce" });
    expect(matchShootToCalendarEvent("Shoot 1 - Glenfinnan", ["2026-11-20"], [e])).toBe(e);
  });

  it("does not match a timed event on the right date with no shared distinctive word", () => {
    const e = event({ startsAt: "2026-11-20T09:00:00Z", title: "Team sync" });
    expect(matchShootToCalendarEvent("Shoot 1 - Glenfinnan", ["2026-11-20"], [e])).toBeNull();
  });

  it("does not match a timed event sharing a word but on the wrong date", () => {
    const e = event({ startsAt: "2026-11-25T09:00:00Z", title: "Glenfinnan recce" });
    expect(matchShootToCalendarEvent("Shoot 1 - Glenfinnan", ["2026-11-20"], [e])).toBeNull();
  });

  it("ignores a declined event", () => {
    const e = event({ startsAt: "2026-11-20T09:00:00Z", title: "Glenfinnan recce", responseStatus: "declined" });
    expect(matchShootToCalendarEvent("Shoot 1 - Glenfinnan", ["2026-11-20"], [e])).toBeNull();
  });

  it("ignores a free (non-busy) event", () => {
    const e = event({ startsAt: "2026-11-20T09:00:00Z", title: "Glenfinnan recce", busy: false });
    expect(matchShootToCalendarEvent("Shoot 1 - Glenfinnan", ["2026-11-20"], [e])).toBeNull();
  });

  it("ignores short/common words as not distinctive", () => {
    const e = event({ startsAt: "2026-11-20T09:00:00Z", title: "Day for the team" });
    expect(matchShootToCalendarEvent("Shoot day for Ava", ["2026-11-20"], [e])).toBeNull();
  });

  it("is null when nothing matches", () => {
    expect(matchShootToCalendarEvent("Shoot 1 - Glenfinnan", ["2026-11-20"], [])).toBeNull();
  });
});
