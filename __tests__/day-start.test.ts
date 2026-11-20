import { describe, expect, it } from "vitest";
import { roundToNearest15, shouldRecordDayStart } from "@/lib/day-start";
import { parseHHMM } from "@/lib/time";

describe("roundToNearest15", () => {
  it("rounds 09:40 to 09:45", () => {
    expect(roundToNearest15(parseHHMM("09:40"))).toBe(parseHHMM("09:45"));
  });

  it("rounds 09:37 down to 09:30", () => {
    expect(roundToNearest15(parseHHMM("09:37"))).toBe(parseHHMM("09:30"));
  });

  it("leaves an exact quarter-hour unchanged", () => {
    expect(roundToNearest15(parseHHMM("08:30"))).toBe(parseHHMM("08:30"));
  });
});

describe("shouldRecordDayStart", () => {
  it("records within the 07:00-11:00 window on a working day", () => {
    expect(shouldRecordDayStart(parseHHMM("09:40"), true)).toBe(true);
    expect(shouldRecordDayStart(parseHHMM("07:00"), true)).toBe(true);
  });

  it("does not record at or after 11:00", () => {
    expect(shouldRecordDayStart(parseHHMM("11:00"), true)).toBe(false);
    expect(shouldRecordDayStart(parseHHMM("18:00"), true)).toBe(false);
  });

  it("does not record before 07:00", () => {
    expect(shouldRecordDayStart(parseHHMM("06:59"), true)).toBe(false);
  });

  it("does not record on a day that isn't a working day", () => {
    expect(shouldRecordDayStart(parseHHMM("09:40"), false)).toBe(false);
  });
});
