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
  const isWorkingDay = settings.working_days.includes(now.weekday);

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

  const [dayStartsResult, eventsResult] = await Promise.all([
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
  ]);

  const dayStartsByDate = new Map(
    (dayStartsResult.data ?? []).map((row) => [row.date, row as { date: string; start_time: string }])
  );
  const events = (eventsResult.data ?? []) as CalendarEventRow[];

  return weekDates.map((dateStr) => {
    const weekday = weekdayOfDateStr(dateStr);
    const isWorkingDay = settings.working_days.includes(weekday);

    const dayStartRow = dayStartsByDate.get(dateStr);
    const defaultStartMinutes = parseHHMM(settings.start_times[weekday] ?? "09:00");
    const startMinutes = dayStartRow ? parseHHMM(dayStartRow.start_time) : defaultStartMinutes;

    const lunchStartMinutes = parseHHMM(settings.lunch_times[weekday] ?? "12:30");

    const allDayEventsToday = events.filter(
      (e) => e.all_day && e.start_date && e.end_date && dateInRange(dateStr, e.start_date, e.end_date)
    );
    const allDayBusy = allDayEventsToday.some((e) => e.busy);

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
      windowStartMinutes: startMinutes,
      windowEndMinutes: startMinutes + settings.hours_per_day * 60 + settings.lunch_minutes,
      capacityHours: result.capacityHours,
      plannedCapacityHours: result.plannedCapacityHours,
      freeBlocks: result.freeBlocks,
      events: dayEvents,
    };
  });
}
