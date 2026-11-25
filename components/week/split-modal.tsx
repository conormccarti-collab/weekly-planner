"use client";

import { useState } from "react";
import type { PlannerTask, Placement } from "@/lib/planner-types";

type Source = "asana" | "personal";
type RemainderDestination = { kind: "next-working-day" } | { kind: "queue" };

/** v5 brief Stage 13b.1: "choose the hours done so far, the rest becomes part two." */
export function SplitModal({
  task,
  placement,
  pending,
  error,
  onSplit,
  onClose,
}: {
  task: PlannerTask;
  placement: Placement;
  pending: boolean;
  error: string | null;
  onSplit: (blockId: string, source: Source, reference: string, hoursNow: number, remainder: RemainderDestination) => void;
  onClose: () => void;
}) {
  const totalHours = (placement.endMinutes - placement.startMinutes) / 60;
  const [hoursNow, setHoursNow] = useState(Math.round((totalHours / 2) * 4) / 4);
  const [destination, setDestination] = useState<RemainderDestination>({ kind: "next-working-day" });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm space-y-3 rounded-2xl border border-border bg-slate p-4 text-sm text-chalk shadow-xl"
      >
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-chalk">Split {task.parentName ? `${task.parentName} — ${task.name}` : task.name}</h3>
          <button onClick={onClose} className="text-chalk-dim hover:text-chalk">
            ✕
          </button>
        </div>
        <p className="text-xs text-chalk-dim">Total {totalHours}h. Choose how much is done now — the rest moves on, same task, linked.</p>

        {error && <p className="rounded border border-danger bg-danger-tint px-2 py-1 text-xs text-chalk">{error}</p>}

        <label className="block text-xs font-medium text-chalk">
          Hours now
          <input
            type="number"
            step="0.25"
            min="0.25"
            max={totalHours - 0.25}
            value={hoursNow}
            onChange={(e) => setHoursNow(Number(e.target.value))}
            className="mt-1 w-full rounded border border-border bg-raven px-2 py-1 text-sm text-chalk"
          />
        </label>

        <label className="block text-xs font-medium text-chalk">
          Remaining {Math.max(0, Math.round((totalHours - hoursNow) * 100) / 100)}h goes to
          <select
            value={destination.kind}
            onChange={(e) => setDestination({ kind: e.target.value as RemainderDestination["kind"] })}
            className="mt-1 w-full rounded border border-border bg-raven px-2 py-1 text-sm text-chalk"
          >
            <option value="next-working-day">Next working day</option>
            <option value="queue">Unscheduled queue</option>
          </select>
        </label>

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <button onClick={onClose} className="rounded border border-border px-3 py-1.5 text-xs text-chalk hover:bg-surface-hover">
            Cancel
          </button>
          <button
            onClick={() => onSplit(placement.id, task.source, task.reference, hoursNow, destination)}
            disabled={pending || !(hoursNow > 0) || hoursNow >= totalHours}
            className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-on-accent disabled:opacity-50"
          >
            Split
          </button>
        </div>
      </div>
    </div>
  );
}
