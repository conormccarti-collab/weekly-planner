export type Interval = { startMinutes: number; endMinutes: number };

export type DayCapacityInput = {
  isWorkingDay: boolean;
  hoursPerDay: number;
  startMinutes: number;
  lunchStartMinutes: number;
  lunchMinutes: number;
  planningPercentage: number;
  allDayBusy: boolean;
  /** Real calendar events only — already resolved for declined/free (brief section 7). */
  busyIntervals: Interval[];
};

export type FreeBlock = Interval;

export type DayCapacityResult = {
  capacityHours: number;
  plannedCapacityHours: number;
  freeBlocks: FreeBlock[];
};

const EMPTY_RESULT: DayCapacityResult = { capacityHours: 0, plannedCapacityHours: 0, freeBlocks: [] };

function clip(interval: Interval, windowStart: number, windowEnd: number): Interval | null {
  const start = Math.max(interval.startMinutes, windowStart);
  const end = Math.min(interval.endMinutes, windowEnd);
  return start < end ? { startMinutes: start, endMinutes: end } : null;
}

/** Overlapping or touching intervals count once (brief section 7). */
function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.startMinutes - b.startMinutes);
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.startMinutes <= last.endMinutes) {
      last.endMinutes = Math.max(last.endMinutes, interval.endMinutes);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

function subtract(window: Interval, blocked: Interval[]): Interval[] {
  const merged = mergeIntervals(blocked);
  const gaps: Interval[] = [];
  let cursor = window.startMinutes;
  for (const block of merged) {
    if (block.startMinutes > cursor) {
      gaps.push({ startMinutes: cursor, endMinutes: Math.min(block.startMinutes, window.endMinutes) });
    }
    cursor = Math.max(cursor, block.endMinutes);
  }
  if (cursor < window.endMinutes) {
    gaps.push({ startMinutes: cursor, endMinutes: window.endMinutes });
  }
  return gaps.filter((g) => g.endMinutes > g.startMinutes);
}

/**
 * Brief section 7: day capacity = hours per day minus busy hours inside the
 * day's window, never below zero. The window is start time for (hours per
 * day + lunch) minutes. Lunch itself is never available for placement, but
 * an event during lunch still counts as busy time against capacity — so
 * lunch is excluded from free blocks but is not separately subtracted from
 * capacity hours (only real events are).
 */
export function computeDayCapacity(input: DayCapacityInput): DayCapacityResult {
  if (!input.isWorkingDay || input.allDayBusy) {
    return EMPTY_RESULT;
  }

  const windowStart = input.startMinutes;
  const windowEnd = windowStart + input.hoursPerDay * 60 + input.lunchMinutes;
  const window: Interval = { startMinutes: windowStart, endMinutes: windowEnd };

  const clippedBusy = input.busyIntervals
    .map((iv) => clip(iv, windowStart, windowEnd))
    .filter((iv): iv is Interval => iv !== null);
  const mergedBusy = mergeIntervals(clippedBusy);
  const busyMinutes = mergedBusy.reduce((sum, iv) => sum + (iv.endMinutes - iv.startMinutes), 0);

  const capacityHours = Math.max(0, input.hoursPerDay - busyMinutes / 60);
  const plannedCapacityHours = capacityHours * (input.planningPercentage / 100);

  const lunchInterval = clip(
    { startMinutes: input.lunchStartMinutes, endMinutes: input.lunchStartMinutes + input.lunchMinutes },
    windowStart,
    windowEnd
  );
  const blockedForPlacement = lunchInterval ? [...mergedBusy, lunchInterval] : mergedBusy;
  const freeBlocks = subtract(window, blockedForPlacement);

  return { capacityHours, plannedCapacityHours, freeBlocks };
}
