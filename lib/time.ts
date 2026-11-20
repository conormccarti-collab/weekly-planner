export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
const WEEKDAY_ORDER: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** The IANA zone's UTC offset, in minutes, at the given instant (handles DST). */
export function getTimeZoneOffsetMinutes(utcInstant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(dtf.formatToParts(utcInstant).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) === 24 ? 0 : Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return (asUtc - utcInstant.getTime()) / 60000;
}

/** The UTC instant for a given local wall-clock date + minutes-from-midnight in timeZone. */
export function localToUtcInstant(dateStr: string, minutesFromMidnight: number, timeZone: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  const naiveUtcGuess = new Date(
    Date.UTC(year, month - 1, day, 0, 0, 0) + minutesFromMidnight * 60000
  );
  const offset = getTimeZoneOffsetMinutes(naiveUtcGuess, timeZone);
  return new Date(naiveUtcGuess.getTime() - offset * 60000);
}

/** The local wall-clock date and minutes-from-midnight for a UTC instant in timeZone. */
export function utcInstantToLocal(
  utcInstant: Date,
  timeZone: string
): { dateStr: string; minutesFromMidnight: number; weekday: Weekday } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
  const parts = Object.fromEntries(dtf.formatToParts(utcInstant).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour) === 24 ? 0 : Number(parts.hour);
  const weekdayMap: Record<string, Weekday> = {
    Mon: "mon",
    Tue: "tue",
    Wed: "wed",
    Thu: "thu",
    Fri: "fri",
    Sat: "sat",
    Sun: "sun",
  };
  return {
    dateStr: `${parts.year}-${parts.month}-${parts.day}`,
    minutesFromMidnight: hour * 60 + Number(parts.minute),
    weekday: weekdayMap[parts.weekday],
  };
}

export function addDaysToDateStr(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return d.toISOString().slice(0, 10);
}

/** Calendar-date (not timezone) weekday for a YYYY-MM-DD string. */
export function weekdayOfDateStr(dateStr: string): Weekday {
  const [year, month, day] = dateStr.split("-").map(Number);
  const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0=Sun..6=Sat
  return WEEKDAY_ORDER[(jsDay + 6) % 7];
}

/** The Monday on or before dateStr (plain calendar-date arithmetic). */
export function mondayOf(dateStr: string): string {
  const weekday = weekdayOfDateStr(dateStr);
  const offset = WEEKDAY_ORDER.indexOf(weekday);
  return addDaysToDateStr(dateStr, -offset);
}

/** dateStr plus n working days (not counting dateStr itself), skipping non-working weekdays. */
export function addWorkingDays(dateStr: string, n: number, workingDays: Weekday[]): string {
  let result = dateStr;
  let remaining = n;
  while (remaining > 0) {
    result = addDaysToDateStr(result, 1);
    if (workingDays.includes(weekdayOfDateStr(result))) remaining--;
  }
  return result;
}

export function parseHHMM(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

export function formatHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60)
    .toString()
    .padStart(2, "0");
  const m = Math.floor(minutes % 60)
    .toString()
    .padStart(2, "0");
  return `${h}:${m}`;
}
