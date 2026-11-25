"use client";

import type { PlannerTask } from "@/lib/planner-types";

type Source = "asana" | "personal";
type EstimateContext = { stage: string | null; focusType: string | null; videoType: string | null };

/**
 * This week's committed-but-unplaced tasks — replaces PlanBoard's inline
 * "Unplaced tasks" list. Distinct from the full backlog (EverythingElseList,
 * kept as-is lower on the page): this is specifically what's already in
 * scope for this week but hasn't landed on a day yet.
 */
export function UnscheduledQueue({
  tasks,
  rejectedKeys,
  pending,
  onToggleMust,
  onPlace,
  onRemove,
  onPickEstimate,
  onAutoSchedule,
  onFillSlack,
}: {
  tasks: PlannerTask[];
  rejectedKeys: Set<string>;
  pending: boolean;
  onToggleMust: (source: Source, reference: string, must: boolean) => void;
  onPlace: (task: PlannerTask) => void;
  onRemove: (source: Source, reference: string) => void;
  onPickEstimate: (reference: string, hours: number, context: EstimateContext) => void;
  onAutoSchedule: () => void;
  onFillSlack: () => void;
}) {
  return (
    <div className="mb-4 rounded-2xl border border-border bg-slate shadow-sm overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold text-chalk">Unscheduled ({tasks.length})</h2>
        <div className="flex items-center gap-1.5">
          <button
            onClick={onFillSlack}
            disabled={pending}
            title="Pull forward extra eligible work from next week to fill any slack this week"
            className="rounded border border-border px-2 py-1 text-[11px] font-medium text-chalk hover:bg-surface-hover disabled:opacity-50"
          >
            Fill slack
          </button>
          {tasks.length > 0 && (
            <button
              onClick={onAutoSchedule}
              disabled={pending}
              className="rounded border border-border px-2 py-1 text-[11px] font-medium text-chalk hover:bg-surface-hover disabled:opacity-50"
            >
              Auto-Schedule
            </button>
          )}
        </div>
      </div>
      {tasks.length === 0 ? (
        <p className="px-3 py-3 text-xs text-chalk-dim">Nothing unscheduled.</p>
      ) : (
        <ul className="divide-y divide-border">
          {tasks.map((task) => (
            <li key={`${task.source}:${task.reference}`} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2 text-xs">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium text-chalk">{task.name}</span>
                {task.parentName && <span className="text-chalk-dim">in {task.parentName}</span>}
                {task.stage && <span className="rounded bg-info-chip px-1.5 py-0.5 text-[10px] font-medium text-chalk">{task.stage}</span>}
                {task.priority && <span className="rounded bg-warning-chip px-1.5 py-0.5 text-[10px] font-medium text-chalk">{task.priority}</span>}
                {task.dueOn && <span className="text-chalk-dim">due {task.dueOn}</span>}
                <span className="text-chalk-dim">{task.estimateDisplay}</span>
                {rejectedKeys.has(`${task.source}:${task.reference}`) && (
                  <span className="rounded bg-surface-hover px-1.5 py-0.5 text-[10px] font-medium text-chalk-dim">Rejected — won&apos;t return to that slot</span>
                )}
                {task.source === "asana" &&
                  task.estimateAmbiguousOptions?.map((option) => (
                    <button
                      key={option.variant}
                      onClick={() => onPickEstimate(task.reference, option.hours, { stage: task.stage, focusType: task.focusType, videoType: task.videoType })}
                      className="rounded border border-info-chip bg-info-chip px-1.5 py-0.5 text-[10px] text-chalk hover:opacity-90"
                    >
                      {option.hours}h ({option.variant})
                    </button>
                  ))}
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-[11px] text-chalk-dim">
                  <input type="checkbox" checked={task.must} onChange={() => onToggleMust(task.source, task.reference, task.must)} className="h-3.5 w-3.5" />
                  Must
                </label>
                <button onClick={() => onPlace(task)} className="rounded border border-border px-1.5 py-0.5 text-[10px] text-chalk hover:bg-surface-hover">
                  Place…
                </button>
                <button onClick={() => onRemove(task.source, task.reference)} className="text-[11px] text-chalk-dim hover:text-danger">
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
