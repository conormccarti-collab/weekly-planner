import { describe, expect, it } from "vitest";
import { computeDayCapacity, type DayCapacityInput } from "@/lib/capacity";
import { parseHHMM } from "@/lib/time";

const BASE: DayCapacityInput = {
  isWorkingDay: true,
  hoursPerDay: 7,
  startMinutes: parseHHMM("09:30"),
  lunchStartMinutes: parseHHMM("12:30"),
  lunchMinutes: 60,
  planningPercentage: 100,
  allDayBusy: false,
  busyIntervals: [],
};

function at(hhmm: string) {
  return parseHHMM(hhmm);
}

describe("computeDayCapacity", () => {
  it("a day with no events has full capacity, window minus lunch as free blocks", () => {
    const result = computeDayCapacity(BASE);
    expect(result.capacityHours).toBe(7);
    expect(result.plannedCapacityHours).toBe(7);
    // window 09:30-17:30, lunch 12:30-13:30
    expect(result.freeBlocks).toEqual([
      { startMinutes: at("09:30"), endMinutes: at("12:30") },
      { startMinutes: at("13:30"), endMinutes: at("17:30") },
    ]);
  });

  it("overlapping meetings count once, not double", () => {
    const result = computeDayCapacity({
      ...BASE,
      busyIntervals: [
        { startMinutes: at("10:00"), endMinutes: at("11:00") },
        { startMinutes: at("10:30"), endMinutes: at("11:30") },
      ],
    });
    // merged busy = 10:00-11:30 = 1.5h
    expect(result.capacityHours).toBe(5.5);
    expect(result.freeBlocks).toEqual([
      { startMinutes: at("09:30"), endMinutes: at("10:00") },
      { startMinutes: at("11:30"), endMinutes: at("12:30") },
      { startMinutes: at("13:30"), endMinutes: at("17:30") },
    ]);
  });

  it("a declined meeting or a 'free' event is never passed in as busy, so it has no effect", () => {
    // Classification happens upstream (lib/calendar/classify.ts); computeDayCapacity
    // only ever sees already-resolved busy intervals, so an empty list is the
    // correct representation of a day whose only events were declined/free.
    const result = computeDayCapacity(BASE);
    expect(result.capacityHours).toBe(7);
  });

  it("an all-day busy event sets capacity to zero for the whole day", () => {
    const result = computeDayCapacity({
      ...BASE,
      allDayBusy: true,
      busyIntervals: [{ startMinutes: at("10:00"), endMinutes: at("11:00") }],
    });
    expect(result.capacityHours).toBe(0);
    expect(result.plannedCapacityHours).toBe(0);
    expect(result.freeBlocks).toEqual([]);
  });

  it("a day with no desk days (not a working day) has zero capacity", () => {
    const result = computeDayCapacity({ ...BASE, isWorkingDay: false });
    expect(result.capacityHours).toBe(0);
    expect(result.freeBlocks).toEqual([]);
  });

  it("an event during lunch still counts as busy time", () => {
    const result = computeDayCapacity({
      ...BASE,
      busyIntervals: [{ startMinutes: at("12:45"), endMinutes: at("13:15") }],
    });
    expect(result.capacityHours).toBe(6.5); // 7 - 0.5h
    expect(result.freeBlocks).toEqual([
      { startMinutes: at("09:30"), endMinutes: at("12:30") },
      { startMinutes: at("13:30"), endMinutes: at("17:30") },
    ]);
  });

  it("capacity never goes below zero", () => {
    const result = computeDayCapacity({
      ...BASE,
      busyIntervals: [{ startMinutes: at("09:30"), endMinutes: at("17:30") }],
    });
    expect(result.capacityHours).toBe(0);
    expect(result.plannedCapacityHours).toBe(0);
  });

  it("planning percentage scales planned capacity but not capacity itself", () => {
    const result = computeDayCapacity({ ...BASE, planningPercentage: 80 });
    expect(result.capacityHours).toBe(7);
    expect(result.plannedCapacityHours).toBeCloseTo(5.6);
  });

  it("changing the start time moves free blocks but not the capacity total", () => {
    const earlyStart = computeDayCapacity({ ...BASE, startMinutes: at("08:30") });
    expect(earlyStart.capacityHours).toBe(7);
    expect(earlyStart.freeBlocks[0]).toEqual({ startMinutes: at("08:30"), endMinutes: at("12:30") });
  });

  it("busy time outside the day's window does not affect capacity", () => {
    const result = computeDayCapacity({
      ...BASE,
      busyIntervals: [{ startMinutes: at("18:00"), endMinutes: at("19:00") }],
    });
    expect(result.capacityHours).toBe(7);
  });
});
