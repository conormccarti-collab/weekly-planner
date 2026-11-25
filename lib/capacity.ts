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
  /**
   * v5 Stage 12g §C: off by default — when false, no break is reserved at
   * all (capacity math matches hoursPerDay exactly, no lunch window added).
   * "fixed" is today's unconditional behaviour (lunchStartMinutes, always).
   * "flexible" floats lunchMinutes somewhere free inside
   * [lunchWindowStart, lunchWindowEnd), dodging any meeting in that window,
   * instead of a clock time that can collide with one.
   */
  lunchEnabled?: boolean;
  lunchMode?: "fixed" | "flexible";
  lunchWindowStart?: number;
  lunchWindowEnd?: number;
};

export type FreeBlock = Interval;

export type DayCapacityResult = {
  capacityHours: number;
  plannedCapacityHours: number;
  freeBlocks: FreeBlock[];
  /** The actual reserved lunch slot (fixed time, or wherever flexible mode landed it) — null when lunch is off, or there's no working window to put it in. */
  lunchInterval: Interval | null;
};

const EMPTY_RESULT: DayCapacityResult = { capacityHours: 0, plannedCapacityHours: 0, freeBlocks: [], lunchInterval: null };

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
function findFlexibleLunchStart(
  dayWindow: Interval,
  lunchMinutes: number,
  lunchWindow: Interval,
  busy: Interval[]
): number {
  const searchStart = Math.max(dayWindow.startMinutes, lunchWindow.startMinutes);
  const searchEnd = Math.min(dayWindow.endMinutes, lunchWindow.endMinutes);
  if (searchEnd - searchStart < lunchMinutes) {
    return Math.max(dayWindow.startMinutes, Math.min(lunchWindow.startMinutes, dayWindow.endMinutes - lunchMinutes));
  }
  const free = subtract({ startMinutes: searchStart, endMinutes: searchEnd }, busy);
  const bigEnough = free.find((g) => g.endMinutes - g.startMinutes >= lunchMinutes);
  // Nothing in the window is fully free — anchor at the window's start and
  // let it merge with whatever's busy there, same as fixed mode already
  // does when a meeting happens to land on the fixed lunch time.
  return bigEnough ? bigEnough.startMinutes : searchStart;
}

export function computeDayCapacity(input: DayCapacityInput): DayCapacityResult {
  if (!input.isWorkingDay || input.allDayBusy) {
    return EMPTY_RESULT;
  }

  const lunchEnabled = input.lunchEnabled ?? false;
  const windowStart = input.startMinutes;
  const windowEnd = windowStart + input.hoursPerDay * 60 + (lunchEnabled ? input.lunchMinutes : 0);
  const window: Interval = { startMinutes: windowStart, endMinutes: windowEnd };

  const clippedBusy = input.busyIntervals
    .map((iv) => clip(iv, windowStart, windowEnd))
    .filter((iv): iv is Interval => iv !== null);
  const mergedBusy = mergeIntervals(clippedBusy);
  const busyMinutes = mergedBusy.reduce((sum, iv) => sum + (iv.endMinutes - iv.startMinutes), 0);

  const capacityHours = Math.max(0, input.hoursPerDay - busyMinutes / 60);
  const plannedCapacityHours = capacityHours * (input.planningPercentage / 100);

  let lunchInterval: Interval | null = null;
  if (lunchEnabled) {
    const lunchStart =
      input.lunchMode === "flexible" && input.lunchWindowStart != null && input.lunchWindowEnd != null
        ? findFlexibleLunchStart(
            window,
            input.lunchMinutes,
            { startMinutes: input.lunchWindowStart, endMinutes: input.lunchWindowEnd },
            mergedBusy
          )
        : input.lunchStartMinutes;
    lunchInterval = clip({ startMinutes: lunchStart, endMinutes: lunchStart + input.lunchMinutes }, windowStart, windowEnd);
  }
  const blockedForPlacement = lunchInterval ? [...mergedBusy, lunchInterval] : mergedBusy;
  const freeBlocks = subtract(window, blockedForPlacement);

  return { capacityHours, plannedCapacityHours, freeBlocks, lunchInterval };
}
