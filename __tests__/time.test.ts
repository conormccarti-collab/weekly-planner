import { describe, expect, it } from "vitest";
import {
  addDaysToDateStr,
  addWorkingDays,
  daysBetweenDateStrs,
  formatHHMM,
  localToUtcInstant,
  mondayOf,
  parseHHMM,
  utcInstantToLocal,
  weekdayOfDateStr,
  type Weekday,
} from "@/lib/time";

const MON_TO_FRI: Weekday[] = ["mon", "tue", "wed", "thu", "fri"];

const LONDON = "Europe/London";

describe("daysBetweenDateStrs", () => {
  it("is 0 for the same date", () => {
    expect(daysBetweenDateStrs("2026-11-20", "2026-11-20")).toBe(0);
  });
  it("is positive when the second date is later", () => {
    expect(daysBetweenDateStrs("2026-11-01", "2026-11-20")).toBe(19);
  });
  it("is negative when the second date is earlier", () => {
    expect(daysBetweenDateStrs("2026-11-20", "2026-11-01")).toBe(-19);
  });
  it("crosses a month boundary correctly", () => {
    expect(daysBetweenDateStrs("2026-10-30", "2026-11-01")).toBe(2);
  });
});

describe("parseHHMM / formatHHMM", () => {
  it("round-trips", () => {
    expect(parseHHMM("09:30")).toBe(570);
    expect(formatHHMM(570)).toBe("09:30");
    expect(parseHHMM("00:00")).toBe(0);
    expect(formatHHMM(0)).toBe("00:00");
  });
});

describe("weekdayOfDateStr / mondayOf", () => {
  it("identifies weekdays correctly", () => {
    expect(weekdayOfDateStr("2026-11-16")).toBe("mon");
    expect(weekdayOfDateStr("2026-11-17")).toBe("tue");
    expect(weekdayOfDateStr("2026-11-22")).toBe("sun");
  });

  it("finds the Monday of the week for any day in it", () => {
    expect(mondayOf("2026-11-18")).toBe("2026-11-16");
    expect(mondayOf("2026-11-22")).toBe("2026-11-16");
    expect(mondayOf("2026-11-16")).toBe("2026-11-16");
  });
});

describe("addDaysToDateStr", () => {
  it("adds and subtracts across month/year boundaries", () => {
    expect(addDaysToDateStr("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDaysToDateStr("2027-01-01", -1)).toBe("2026-12-31");
  });
});

describe("localToUtcInstant / utcInstantToLocal", () => {
  it("round-trips a winter (GMT, UTC+0) local time", () => {
    const utc = localToUtcInstant("2026-01-15", parseHHMM("09:30"), LONDON);
    expect(utc.toISOString()).toBe("2026-01-15T09:30:00.000Z");
    const local = utcInstantToLocal(utc, LONDON);
    expect(local.dateStr).toBe("2026-01-15");
    expect(local.minutesFromMidnight).toBe(parseHHMM("09:30"));
    expect(local.weekday).toBe("thu");
  });

  it("round-trips a summer (BST, UTC+1) local time", () => {
    const utc = localToUtcInstant("2026-07-15", parseHHMM("09:30"), LONDON);
    // 09:30 BST == 08:30 UTC
    expect(utc.toISOString()).toBe("2026-07-15T08:30:00.000Z");
    const local = utcInstantToLocal(utc, LONDON);
    expect(local.dateStr).toBe("2026-07-15");
    expect(local.minutesFromMidnight).toBe(parseHHMM("09:30"));
  });

  it("handles a UTC instant that falls on the previous local day", () => {
    // 23:30 UTC on Jan 15 is 23:30 GMT (same day, London is UTC+0 in winter)
    const local = utcInstantToLocal(new Date("2026-01-15T23:30:00.000Z"), LONDON);
    expect(local.dateStr).toBe("2026-01-15");

    // but in a UTC+1 zone it would roll into the next day — sanity check with America/New_York (UTC-5)
    // 02:30 UTC on Jan 16 is 21:30 the previous day in New York
    const nyLocal = utcInstantToLocal(new Date("2026-01-16T02:30:00.000Z"), "America/New_York");
    expect(nyLocal.dateStr).toBe("2026-01-15");
    expect(nyLocal.minutesFromMidnight).toBe(parseHHMM("21:30"));
  });
});

describe("addWorkingDays", () => {
  it("skips the weekend", () => {
    // Thursday 2026-11-19 + 2 working days = Monday 2026-11-23 (skips Sat/Sun)
    expect(addWorkingDays("2026-11-19", 2, MON_TO_FRI)).toBe("2026-11-23");
  });

  it("never counts the starting date itself", () => {
    expect(addWorkingDays("2026-11-16", 1, MON_TO_FRI)).toBe("2026-11-17");
  });

  it("respects a non-default working-day set", () => {
    const withSaturday: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat"];
    expect(addWorkingDays("2026-11-19", 2, withSaturday)).toBe("2026-11-21");
  });
});
