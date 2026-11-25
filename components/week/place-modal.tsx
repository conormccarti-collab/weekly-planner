"use client";

import { useState } from "react";
import type { PlannerTask } from "@/lib/planner-types";
import type { DayCapacityView } from "@/lib/calendar/week-capacity";
import { WEEKDAY_LABELS } from "@/lib/settings";
import { formatHHMM } from "@/lib/time";

type Source = "asana" | "personal";

function timeOptions(windowStart: number, windowEnd: number): number[] {
  const options: number[] = [];
  for (let m = windowStart; m < windowEnd; m += 15) options.push(m);
  return options;
}

/**
 * Tap alternative to dragging an unplaced task onto the calendar — the modal
 * replacement for PlanBoard's inline PlacementPicker popover. Used both from
 * the Unscheduled Queue's "Schedule" action and a day card's "+ Block"
 * button (which pre-fills `initialDay`).
 */
export function PlaceModal({
  task,
  allDays,
  initialDay,
  pending,
  error,
  onPlace,
  onClose,
}: {
  task: PlannerTask;
  allDays: DayCapacityView[];
  initialDay?: string;
  pending: boolean;
  error: string | null;
  onPlace: (source: Source, reference: string, day: string, start: number, end: number) => void;
  onClose: () => void;
}) {
  const workingDays = allDays.filter((d) => d.isWorkingDay);
  const [day, setDay] = useState(initialDay ?? workingDays[0]?.dateStr ?? "");
  const defaultDurationMinutes = Math.max(15, Math.round(((task.estimateHours ?? 0.25) * 60) / 15) * 15);
  const [start, setStart] = useState<number | null>(null);
  const [duration, setDuration] = useState(defaultDurationMinutes);
  const durationOptions = [...new Set([15, 30, 45, 60, 90, 120, 180, 240, 300, 360, 420, 480, defaultDurationMinutes])].sort((a, b) => a - b);

  const dayView = workingDays.find((d) => d.dateStr === day);
  const options = dayView ? timeOptions(dayView.windowStartMinutes, dayView.windowEndMinutes) : [];
  const startValue = start ?? options[0] ?? 0;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm space-y-3 rounded-2xl border border-border bg-slate p-4 text-sm text-chalk shadow-xl"
      >
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-chalk">{task.parentName ? `${task.parentName} — ${task.name}` : task.name}</h3>
          <button onClick={onClose} className="text-chalk-dim hover:text-chalk">
            ✕
          </button>
        </div>

        {error && <p className="rounded border border-danger bg-danger-tint px-2 py-1 text-xs text-chalk">{error}</p>}

        <div className="grid grid-cols-3 gap-2">
          <select
            aria-label="Day"
            value={day}
            onChange={(e) => setDay(e.target.value)}
            className="rounded border border-border bg-raven px-1 py-1 text-xs text-chalk"
          >
            {workingDays.map((d) => (
              <option key={d.dateStr} value={d.dateStr}>
                {WEEKDAY_LABELS[d.weekday]} {d.dateStr}
              </option>
            ))}
          </select>
          <select
            aria-label="Start time"
            value={startValue}
            onChange={(e) => setStart(Number(e.target.value))}
            className="rounded border border-border bg-raven px-1 py-1 text-xs text-chalk"
          >
            {options.map((m) => (
              <option key={m} value={m}>
                {formatHHMM(m)}
              </option>
            ))}
          </select>
          <select
            aria-label="Duration"
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="rounded border border-border bg-raven px-1 py-1 text-xs text-chalk"
          >
            {durationOptions.map((d) => (
              <option key={d} value={d}>
                {(d / 60).toFixed(2).replace(/\.?0+$/, "")}h
              </option>
            ))}
          </select>
        </div>

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <button onClick={onClose} className="rounded border border-border px-3 py-1.5 text-xs text-chalk hover:bg-surface-hover">
            Cancel
          </button>
          <button
            onClick={() => onPlace(task.source, task.reference, day, startValue, startValue + duration)}
            disabled={pending || !day}
            className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-on-accent disabled:opacity-50"
          >
            Place
          </button>
        </div>
      </div>
    </div>
  );
}
