"use client";

import { useTransition } from "react";
import { setWorkingDayOverride } from "@/app/(app)/capacity/actions";
import type { DayCapacityView } from "@/lib/calendar/week-capacity";

/**
 * The complement to DayLockControl: turns an otherwise non-working date (a
 * weekend, or any weekday outside settings.working_days) into a real
 * working day for that one date — "I'll be working Saturday this week."
 * Shows "Work this day" on a plain non-working, unlocked date, and "Remove
 * override" once one is set (back to a plain non-working day).
 */
export function WorkingDayOverrideControl({ day }: { day: DayCapacityView }) {
  const [pending, startTransition] = useTransition();

  if (day.isLocked) return null; // a lock already wins — nothing to toggle here
  if (day.isWorkingDay && !day.isWorkingDayOverride) return null; // a normal pattern working day — nothing to override

  return (
    <button
      onClick={() => startTransition(() => setWorkingDayOverride(day.dateStr, !day.isWorkingDayOverride))}
      disabled={pending}
      className={`rounded border px-2 py-1 text-[11px] disabled:opacity-50 ${
        day.isWorkingDayOverride ? "border-success bg-success-tint text-success hover:opacity-90" : "border-border text-chalk hover:bg-surface-hover"
      }`}
    >
      {day.isWorkingDayOverride ? "Remove override" : "Work this day"}
    </button>
  );
}
