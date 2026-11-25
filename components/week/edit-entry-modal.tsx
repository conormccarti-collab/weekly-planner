"use client";

import { useState } from "react";
import type { PlannerTask, Placement } from "@/lib/planner-types";
import type { DayCapacityView } from "@/lib/calendar/week-capacity";
import { formatHHMM } from "@/lib/time";

type Source = "asana" | "personal";
type EstimateContext = { stage: string | null; focusType: string | null; videoType: string | null };

function timeOptions(windowStart: number, windowEnd: number): number[] {
  const options: number[] = [];
  for (let m = windowStart; m < windowEnd; m += 15) options.push(m);
  return options;
}

/**
 * Tap/edit alternative to dragging — the modal replacement for CalendarGrid's
 * inline BlockEditor. Same fields, same actions, just a dialog instead of an
 * expanding box in the grid (which no longer exists).
 */
export function EditEntryModal({
  task,
  placement,
  allDays,
  pending,
  error,
  onMove,
  onRemove,
  onToggleMust,
  onConfirmSuggested,
  onOpenSplit,
  onClose,
}: {
  task: PlannerTask;
  placement: Placement;
  allDays: DayCapacityView[];
  pending: boolean;
  error: string | null;
  onMove: (blockId: string, source: Source, reference: string, day: string, start: number, end: number, estimateContext: EstimateContext) => void;
  onRemove: (blockId: string, source: Source, reference: string, must: boolean) => void;
  onToggleMust: (source: Source, reference: string, must: boolean) => void;
  onConfirmSuggested: (blockId: string, source: Source, reference: string, estimateContext: EstimateContext) => void;
  onOpenSplit: () => void;
  onClose: () => void;
}) {
  const [day, setDay] = useState(placement.day);
  const [start, setStart] = useState(placement.startMinutes);
  const [duration, setDuration] = useState(placement.endMinutes - placement.startMinutes);

  const dayView = allDays.find((d) => d.dateStr === day);
  const options = dayView ? timeOptions(dayView.windowStartMinutes, dayView.windowEndMinutes) : [];
  const durationOptions = [...new Set([15, 30, 45, 60, 90, 120, 180, 240, 300, 360, 420, 480, duration])].sort((a, b) => a - b);
  const isDone = placement.status === "done";

  function save() {
    onMove(placement.id, task.source, task.reference, day, start, start + duration, {
      stage: task.stage,
      focusType: task.focusType,
      videoType: task.videoType,
    });
  }

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
            className="col-span-1 rounded border border-border bg-raven px-1 py-1 text-xs text-chalk"
          >
            {allDays
              .filter((d) => d.isWorkingDay)
              .map((d) => (
                <option key={d.dateStr} value={d.dateStr}>
                  {d.dateStr}
                </option>
              ))}
          </select>
          <select
            aria-label="Start time"
            value={start}
            onChange={(e) => setStart(Number(e.target.value))}
            className="col-span-1 rounded border border-border bg-raven px-1 py-1 text-xs text-chalk"
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
            className="col-span-1 rounded border border-border bg-raven px-1 py-1 text-xs text-chalk"
          >
            {durationOptions.map((d) => (
              <option key={d} value={d}>
                {(d / 60).toFixed(2).replace(/\.?0+$/, "")}h
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={task.must} onChange={() => onToggleMust(task.source, task.reference, task.must)} className="h-3.5 w-3.5" />
            Must
          </label>
          {!isDone && (
            <button onClick={onOpenSplit} className="rounded border border-border px-2 py-1 text-xs text-chalk hover:bg-surface-hover">
              Split…
            </button>
          )}
          {placement.status === "suggested" && (
            <button
              onClick={() =>
                onConfirmSuggested(placement.id, task.source, task.reference, { stage: task.stage, focusType: task.focusType, videoType: task.videoType })
              }
              className="rounded border border-border px-2 py-1 text-xs text-chalk hover:bg-surface-hover"
            >
              Confirm estimate
            </button>
          )}
          <button
            onClick={() => onRemove(placement.id, task.source, task.reference, task.must)}
            className="ml-auto text-xs text-chalk-dim hover:text-danger"
          >
            Remove from calendar
          </button>
        </div>

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <button onClick={onClose} className="rounded border border-border px-3 py-1.5 text-xs text-chalk hover:bg-surface-hover">
            Cancel
          </button>
          <button onClick={save} disabled={pending} className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-on-accent disabled:opacity-50">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
