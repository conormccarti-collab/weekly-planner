"use client";

import { useState, useTransition } from "react";
import { setDayStart } from "@/app/(app)/capacity/actions";
import type { DayCapacityView } from "@/lib/calendar/week-capacity";

export function DayStartBadge({ day }: { day: DayCapacityView }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(day.startLabel);
  const [pending, startTransition] = useTransition();

  if (editing) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            await setDayStart(day.dateStr, value);
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
      {day.startIsActual ? day.startLabel : `default ${day.startLabel}`}{" "}
      <button onClick={() => setEditing(true)} className="underline hover:opacity-80">
        Change
      </button>
    </span>
  );
}
