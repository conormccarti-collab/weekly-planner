/** Brief section 7: actual start is rounded to the nearest 15 minutes. */
export function roundToNearest15(minutesFromMidnight: number): number {
  return Math.round(minutesFromMidnight / 15) * 15;
}

/**
 * Brief section 7: only record a start when the app is first opened between
 * 07:00 and 11:00 on a day with capacity (a working day). Outside that
 * window — evening, weekend, or a day that isn't a working day — nothing
 * is recorded; a first open after 11:00 uses the weekday default instead.
 */
export function shouldRecordDayStart(minutesFromMidnight: number, isWorkingDay: boolean): boolean {
  return isWorkingDay && minutesFromMidnight >= 7 * 60 && minutesFromMidnight < 11 * 60;
}
