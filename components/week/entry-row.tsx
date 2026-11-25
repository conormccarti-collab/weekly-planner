"use client";

import type { PlannerTask, Placement } from "@/lib/planner-types";
import type { DayEventView } from "@/lib/calendar/week-capacity";
import { formatHHMM } from "@/lib/time";
import { brandColorsFor } from "@/lib/brand-colors";

type Source = "asana" | "personal";

/**
 * One row in a day's list — either a placed task block or a read-only
 * calendar event. Replaces CalendarGrid's absolutely-positioned block div
 * with a plain list item; the brand tag / suggested / final / blocked / part
 * label styling is carried over as-is, just horizontal instead of a box.
 */
export function EntryRow(
  props:
    | {
        kind: "placement";
        task: PlannerTask;
        placement: Placement;
        onToggleDone: (blockId: string, status: string, hours: number) => void;
        onToggleMust: (source: Source, reference: string, must: boolean) => void;
        onEdit: () => void;
        onSplit: () => void;
        onRemove: (blockId: string, source: Source, reference: string, must: boolean) => void;
        onLock: (blockId: string) => void;
        /** Set once this task is done and has a pending "check it off in Asana too" reminder. */
        checkoffReminderId?: string;
        onDismissCheckoff?: (id: string) => void;
      }
    | { kind: "event"; event: DayEventView }
    | { kind: "lunch"; startMinutes: number; endMinutes: number }
) {
  if (props.kind === "lunch") {
    return (
      <div className="flex items-center justify-between gap-2 rounded border border-dashed border-border px-2 py-1.5 text-xs text-chalk-dim">
        <span className="truncate">{formatHHMM(props.startMinutes)}–{formatHHMM(props.endMinutes)} · Lunch</span>
      </div>
    );
  }

  if (props.kind === "event") {
    const { event } = props;
    return (
      <div className="flex items-center justify-between gap-2 rounded border border-border bg-surface-hover px-2 py-1.5 text-xs text-chalk-dim">
        <span className="truncate">
          {event.allDay ? "All day" : event.startLabel && event.endLabel ? `${event.startLabel}–${event.endLabel}` : "Time unknown"} ·{" "}
          <span className="text-chalk">{event.title}</span>
        </span>
        <span className="shrink-0 rounded bg-slate px-1.5 py-0.5 text-[10px] font-medium text-chalk-dim">Calendar</span>
      </div>
    );
  }

  const { task, placement, onToggleDone, onToggleMust, onEdit, onSplit, onRemove, onLock, checkoffReminderId, onDismissCheckoff } = props;
  const brand = brandColorsFor(task.brand);
  const isSuggested = placement.status === "suggested";
  const isDone = placement.status === "done";
  const canSplit = !isDone && placement.hours >= 0.5;

  return (
    <div
      data-plan-block={placement.id}
      className="flex items-start gap-2 rounded border border-border px-2 py-1.5 text-xs"
      style={{
        backgroundColor: brand.tint,
        borderLeftColor: brand.edge,
        borderLeftWidth: 3,
        borderLeftStyle: brand.dashed ? "dashed" : "solid",
      }}
    >
      <input
        type="checkbox"
        checked={isDone}
        onChange={() => onToggleDone(placement.id, placement.status, placement.actualHours ?? placement.hours)}
        className="mt-0.5 h-3.5 w-3.5 shrink-0"
      />

      <div className="min-w-0 flex-1">
        <div className={`truncate font-medium text-chalk ${isDone ? "line-through opacity-70" : ""}`}>
          {task.parentName ? `${task.parentName} — ${task.name}` : task.name}
          {placement.isFinal && (
            <span title="This task's last block this week" className="ml-1 rounded bg-slate px-1 text-[9px] font-normal text-chalk-dim">
              final
            </span>
          )}
          {isSuggested && <span className="ml-1 rounded bg-warning-chip px-1 text-[9px] font-normal text-chalk">suggested</span>}
          {task.isBlocked && (
            <span title="Still waiting on a blocker" className="ml-1 rounded bg-danger-tint px-1 text-[9px] font-normal text-danger">
              blocked
            </span>
          )}
        </div>
        <div className="truncate text-chalk-dim">
          {placement.partCount ? `Part ${placement.partIndex} of ${placement.partCount} · ` : ""}
          {formatHHMM(placement.startMinutes)}–{formatHHMM(placement.endMinutes)} · {brand.label} ·{" "}
          {(placement.endMinutes - placement.startMinutes) / 60}h
        </div>
        {isDone && checkoffReminderId && (
          <label className="mt-1 flex w-fit cursor-pointer items-center gap-1.5 rounded border border-warning bg-warning-tint px-1.5 py-1 text-[11px] font-semibold text-chalk">
            <input type="checkbox" onChange={() => onDismissCheckoff?.(checkoffReminderId)} className="h-3.5 w-3.5 shrink-0" />
            ⚠ Check this off in Asana too
          </label>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <label className="flex items-center gap-0.5 text-[10px] text-chalk-dim">
          <input type="checkbox" checked={task.must} onChange={() => onToggleMust(task.source, task.reference, task.must)} className="h-3 w-3" />
          Must
        </label>
        <button onClick={onEdit} className="rounded border border-border px-1.5 py-0.5 text-[10px] text-chalk hover:bg-surface-hover">
          Edit
        </button>
        {canSplit && (
          <button onClick={onSplit} className="rounded border border-border px-1.5 py-0.5 text-[10px] text-chalk hover:bg-surface-hover">
            Split
          </button>
        )}
        {!placement.pinned && !isDone && (
          <button
            onClick={() => onLock(placement.id)}
            title="Stop Auto-Schedule or Regenerate from moving this block"
            className="rounded border border-border px-1.5 py-0.5 text-[10px] text-chalk hover:bg-surface-hover"
          >
            Lock
          </button>
        )}
        <button
          onClick={() => onRemove(placement.id, task.source, task.reference, task.must)}
          className="text-chalk-dim hover:text-danger"
          title="Remove from calendar"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
