"use client";

import { useState, useTransition } from "react";
import { setLunchOverride } from "@/app/(app)/capacity/actions";
import type { DayCapacityView } from "@/lib/calendar/week-capacity";

export function LunchOverrideBadge({ day }: { day: DayCapacityView }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(day.lunchLabel);
  const [pending, startTransition] = useTransition();

  if (editing) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            await setLunchOverride(day.dateStr, value);
            setEditing(false);
          });
        }}
        className="flex items-center gap-1"
      >
        <input
          type="time"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-20 rounded border border-border bg-slate px-1 py-0.5 text-[10px] text-chalk"
        />
        <button type="submit" disabled={pending} className="text-[10px] text-chalk underline">
          Save
        </button>
      </form>
    );
  }

  return (
    <span className="text-[10px] text-chalk">
      {day.lunchIsActual ? day.lunchLabel : `default ${day.lunchLabel}`}{" "}
      <button onClick={() => setEditing(true)} className="underline hover:opacity-80">
        Change
      </button>
    </span>
  );
}
