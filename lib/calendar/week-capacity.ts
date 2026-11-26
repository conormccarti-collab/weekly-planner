import type { SupabaseClient } from "@supabase/supabase-js";
import { computeDayCapacity, type FreeBlock } from "@/lib/capacity";
import { roundToNearest15, shouldRecordDayStart } from "@/lib/day-start";
import {
  addDaysToDateStr,
  formatHHMM,
  mondayOf,
  parseHHMM,
  utcInstantToLocal,
  weekdayOfDateStr,
  type Weekday,
} from "@/lib/time";
import type { Settings } from "@/lib/settings";

export type DayEventView = {
  id: string;
  title: string;
  allDay: boolean;
  busy: boolean;
  startLabel: string | null;
  endLabel: string | null;
};

export type DayCapacityView = {
  dateStr: string;
  weekday: Weekday;
  isWorkingDay: boolean;
  startLabel: string;
  startIsActual: boolean;
  lunchLabel: string;
  lunchIsActual: boolean;
  /** The actual reserved lunch slot, for display as a row in the day's timeline — null when lunch is off (settings.lunch_enabled) or the day has no working window. */
  lunchInterval: FreeBlock | null;
  /** v5 Stage 13a: hours withheld from today's freeBlocks as buffer — 0 when settings.buffer_percentage is 0 or the day has no free time to withhold. */
  bufferHours: number;
  isLocked: boolean;
  lockedReason: string | null;
  /** "manual" = set via the day-card's Lock day button; "calendar" = an all-day busy event (incl. a real Google Out of Office entry) already blocks the day — nothing to toggle, the Lock control just shows a label. */
  lockSource: "manual" | "calendar" | null;
  /** v5: this date isn't in settings.working_days, but a working_day_overrides row marks it worked anyway (e.g. "I'll be working Saturday this week") — isWorkingDay is already true for it, this just flags *why*, so the UI can offer to remove the override. */
  isWorkingDayOverride: boolean;
  windowStartMinutes: number;
  windowEndMinutes: number;
  capacityHours: number;
  plannedCapacityHours: number;
  freeBlocks: FreeBlock[];
  events: DayEventView[];
};

type CalendarEventRow = {
  event_id: string;
  title: string;
  starts_at: string | null;
  ends_at: string | null;
  all_day: boolean;
  start_date: string | null;
  end_date: string | null;
  busy: boolean;
};

/** Brief section 7: records today's actual start the first time the app opens, 07:00-11:00. */
export async function ensureDayStartRecorded(
  supabase: SupabaseClient,
  userId: string,
  timezone: string,
  settings: Settings
): Promise<void> {
  const now = utcInstantToLocal(new Date(), timezone);
  // Best-effort — migration 0033 may not be applied yet; a failed query
  // here just means no override, same as getWeekCapacity's own read below.
  const { data: override } = await supabase.from("working_day_overrides").select("date").eq("user_id", userId).eq("date", now.dateStr).maybeSingle();
  const isWorkingDay = settings.working_days.includes(now.weekday) || !!override;

  if (!shouldRecordDayStart(now.minutesFromMidnight, isWorkingDay)) {
    return;
  }

  const { data: existing } = await supabase
    .from("day_starts")
    .select("date")
    .eq("user_id", userId)
    .eq("date", now.dateStr)
    .maybeSingle();

  if (existing) {
    return;
  }

  const rounded = roundToNearest15(now.minutesFromMidnight);
  await supabase.from("day_starts").insert({
    user_id: userId,
    date: now.dateStr,
    start_time: formatHHMM(rounded),
    corrected: false,
  });
}

function dateInRange(dateStr: string, startDate: string, endDateExclusive: string): boolean {
  return dateStr >= startDate && dateStr < endDateExclusive;
}

export async function getWeekCapacity(
  supabase: SupabaseClient,
  userId: string,
  timezone: string,
  settings: Settings,
  weekStart?: string,
  options?: { useActualStarts?: boolean }
): Promise<DayCapacityView[]> {
  const todayStr = utcInstantToLocal(new Date(), timezone).dateStr;
  const resolvedWeekStart = weekStart ?? mondayOf(todayStr);
  const useActualStarts = options?.useActualStarts ?? true;
  const weekDates = Array.from({ length: 7 }, (_, i) => addDaysToDateStr(resolvedWeekStart, i));
  const weekEndExclusive = addDaysToDateStr(resolvedWeekStart, 7);

  const [dayStartsResult, eventsResult, lunchOverridesResult, dayLocksResult, workingDayOverridesResult] = await Promise.all([
    useActualStarts
      ? supabase
          .from("day_starts")
          .select("date, start_time, corrected")
          .eq("user_id", userId)
          .gte("date", resolvedWeekStart)
          .lt("date", weekEndExclusive)
      : Promise.resolve({ data: [] }),
    supabase
      .from("calendar_events")
      .select("event_id, title, starts_at, ends_at, all_day, start_date, end_date, busy")
      .eq("user_id", userId),
    // Migration 0026 may not be applied yet — same best-effort pattern as
    // settings-data.ts's BREAK_SETTINGS_COLUMNS fetch: a failed query here
    // (missing table/column) leaves `data` null and is treated as "no
    // overrides", never thrown.
    supabase.from("lunch_overrides").select("date, lunch_start_time").eq("user_id", userId).gte("date", resolvedWeekStart).lt("date", weekEndExclusive),
    supabase.from("day_locks").select("date, reason").eq("user_id", userId).gte("date", resolvedWeekStart).lt("date", weekEndExclusive),
    // Migration 0033 may not be applied yet — same best-effort pattern as day_locks/lunch_overrides above.
    supabase.from("working_day_overrides").select("date").eq("user_id", userId).gte("date", resolvedWeekStart).lt("date", weekEndExclusive),
  ]);

  const dayStartsByDate = new Map(
    (dayStartsResult.data ?? []).map((row) => [row.date, row as { date: string; start_time: string }])
  );
  const events = (eventsResult.data ?? []) as CalendarEventRow[];
  const lunchOverridesByDate = new Map(
    (lunchOverridesResult.data ?? []).map((row) => [row.date as string, row.lunch_start_time as string])
  );
  const dayLocksByDate = new Map((dayLocksResult.data ?? []).map((row) => [row.date as string, (row.reason as string | null) ?? null]));
  const workingDayOverrideDates = new Set((workingDayOverridesResult.data ?? []).map((row) => row.date as string));

  return weekDates.map((dateStr) => {
    const weekday = weekdayOfDateStr(dateStr);
    const manualLockReason = dayLocksByDate.get(dateStr);
    const isManuallyLocked = dayLocksByDate.has(dateStr);
    const isWorkingDayOverride = workingDayOverrideDates.has(dateStr);
    // A manual lock overrides the weekly working-days pattern for this one
    // date — the single point every downstream consumer (capacity totals,
    // freeBlocksByDay/dayOrder in plan-build-data.ts, the day-card filter)
    // already reads, so nothing else needs to know about it directly. A
    // working_day_overrides row is the complement: it turns an otherwise
    // non-working date (a weekend) into a real working one the same way —
    // a lock still wins if somehow both exist for the same date.
    // An all-day busy calendar event (below) deliberately does NOT also
    // flip this — lib/summary.ts's zeroCapacityReasonFor relies on
    // isWorkingDay staying true there to tell "blocked by a named leave
    // event" apart from "not a working day at all", and the zero-capacity
    // result from computeDayCapacity already excludes it from placement
    // either way.
    const isWorkingDay = !isManuallyLocked && (settings.working_days.includes(weekday) || isWorkingDayOverride);

    const dayStartRow = dayStartsByDate.get(dateStr);
    const defaultStartMinutes = parseHHMM(settings.start_times[weekday] ?? "09:00");
    const startMinutes = dayStartRow ? parseHHMM(dayStartRow.start_time) : defaultStartMinutes;

    const lunchOverride = lunchOverridesByDate.get(dateStr);
    const lunchStartMinutes = parseHHMM(lunchOverride ?? settings.lunch_times[weekday] ?? "12:30");

    const allDayEventsToday = events.filter(
      (e) => e.all_day && e.start_date && e.end_date && dateInRange(dateStr, e.start_date, e.end_date)
    );
    // Covers both a real Google Out of Office entry and a hand-created
    // all-day event (e.g. "Annual Leave", "Bank Holiday") — sync.ts already
    // normalises a native OOO event (which Google sends with timed
    // dateTime fields, not a date-only span) into this same all_day shape,
    // so this one check already catches both without needing to know which
    // kind it is.
    const calendarBlockingEvent = allDayEventsToday.find((e) => e.busy);
    const allDayBusy = !!calendarBlockingEvent;
    const isLocked = isManuallyLocked || allDayBusy;
    const lockSource: DayCapacityView["lockSource"] = isManuallyLocked ? "manual" : allDayBusy ? "calendar" : null;
    const lockedReason = manualLockReason ?? calendarBlockingEvent?.title ?? null;

    const timedEventsToday = events.filter((e) => {
      if (e.all_day || !e.starts_at) return false;
      return utcInstantToLocal(new Date(e.starts_at), timezone).dateStr === dateStr;
    });

    const busyIntervals = timedEventsToday
      .filter((e) => e.busy)
      .map((e) => ({
        startMinutes: utcInstantToLocal(new Date(e.starts_at!), timezone).minutesFromMidnight,
        endMinutes: utcInstantToLocal(new Date(e.ends_at!), timezone).minutesFromMidnight,
      }));

    const result = computeDayCapacity({
      isWorkingDay,
      hoursPerDay: settings.hours_per_day,
      startMinutes,
      lunchStartMinutes,
      lunchMinutes: settings.lunch_minutes,
      planningPercentage: settings.planning_percentage,
      allDayBusy,
      busyIntervals,
      lunchEnabled: settings.lunch_enabled,
      lunchMode: settings.lunch_mode,
      lunchWindowStart: settings.lunch_window_start ? parseHHMM(settings.lunch_window_start) : undefined,
      lunchWindowEnd: settings.lunch_window_end ? parseHHMM(settings.lunch_window_end) : undefined,
      bufferPercentage: settings.buffer_percentage,
    });

    const dayEvents: DayEventView[] = [...allDayEventsToday, ...timedEventsToday].map((e) => ({
      id: e.event_id,
      title: e.title,
      allDay: e.all_day,
      busy: e.busy,
      startLabel: e.all_day
        ? null
        : formatHHMM(utcInstantToLocal(new Date(e.starts_at!), timezone).minutesFromMidnight),
      endLabel: e.all_day
        ? null
        : formatHHMM(utcInstantToLocal(new Date(e.ends_at!), timezone).minutesFromMidnight),
    }));

    return {
      dateStr,
      weekday,
      isWorkingDay,
      startLabel: formatHHMM(startMinutes),
      startIsActual: !!dayStartRow,
      lunchLabel: formatHHMM(lunchStartMinutes),
      lunchIsActual: lunchOverride != null,
      lunchInterval: result.lunchInterval,
      bufferHours: result.bufferHours,
      isLocked,
      lockedReason,
      lockSource,
      isWorkingDayOverride,
      windowStartMinutes: startMinutes,
      windowEndMinutes: startMinutes + settings.hours_per_day * 60 + (settings.lunch_enabled ? settings.lunch_minutes : 0),
      capacityHours: result.capacityHours,
      plannedCapacityHours: result.plannedCapacityHours,
      freeBlocks: result.freeBlocks,
      events: dayEvents,
    };
  });
}
