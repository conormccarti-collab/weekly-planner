"use client";

import { useTransition } from "react";
import { setDayLock } from "@/app/(app)/capacity/actions";
import type { DayCapacityView } from "@/lib/calendar/week-capacity";

/**
 * Toggles a single date as unavailable — excluded from auto-placement (see
 * getWeekCapacity). When the lock is already set by a calendar event
 * (a real Out of Office entry, or any all-day busy event), there's nothing
 * to toggle here — this just shows that, since unlocking it would mean
 * editing the calendar, not this app.
 */
export function DayLockControl({ day }: { day: DayCapacityView }) {
  const [pending, startTransition] = useTransition();

  if (day.lockSource === "calendar") {
    return (
      <span className="rounded border border-border px-2 py-1 text-[11px] text-chalk-dim" title={day.lockedReason ?? undefined}>
        From calendar
      </span>
    );
  }

  return (
    <button
      onClick={() => startTransition(() => setDayLock(day.dateStr, !day.isLocked))}
      disabled={pending}
      className={`rounded border px-2 py-1 text-[11px] disabled:opacity-50 ${
        day.isLocked ? "border-danger bg-danger-tint text-danger hover:opacity-90" : "border-border text-chalk hover:bg-surface-hover"
      }`}
    >
      {day.isLocked ? "Unlock" : "Lock day"}
    </button>
  );
}
