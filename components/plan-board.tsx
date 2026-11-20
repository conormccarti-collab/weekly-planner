"use client";

import { useState, useTransition } from "react";
import {
  placeBlock,
  moveBlock,
  splitBlock,
  removeBlock,
  removeFromWeek,
  saveWeekPlan,
  setPlanMust,
  markDone,
  markNotDone,
} from "@/app/(app)/plan/actions";
import { setTaskEstimate } from "@/app/(app)/tasks/actions";
import type { PlannerTask } from "@/lib/planner-types";
import type { DayCapacityView } from "@/lib/calendar/week-capacity";
import { CalendarGrid, type Dragging } from "@/components/calendar-grid";
import type { ShootMarker } from "@/lib/asana/shoots";
import { WEEKDAY_LABELS } from "@/lib/settings";
import { formatHHMM, mondayOf } from "@/lib/time";
import { formatPlanAsText } from "@/lib/plan-text";

type Source = "asana" | "personal";
type EstimateContext = { stage: string | null; focusType: string | null; videoType: string | null };

function timeOptions(windowStart: number, windowEnd: number): number[] {
  const options: number[] = [];
  for (let m = windowStart; m < windowEnd; m += 15) options.push(m);
  return options;
}

export function PlanBoard({
  weekStart,
  weekStatus,
  todayStr,
  days,
  followingDays,
  thisWeekTasks,
  shoots,
}: {
  weekStart: string;
  weekStatus: "draft" | "saved";
  todayStr: string;
  days: DayCapacityView[];
  followingDays: DayCapacityView[];
  thisWeekTasks: PlannerTask[];
  shoots: ShootMarker[];
}) {
  const [, startTransition] = useTransition();
  const [dragging, setDragging] = useState<Dragging | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const allDays = [...days, ...followingDays];
  const unplaced = thisWeekTasks.filter((t) => t.placements.length === 0);

  function runAction(action: () => Promise<void | { warning?: string }>) {
    startTransition(async () => {
      try {
        const result = await action();
        if (result?.warning) {
          setWarning(result.warning);
          setTimeout(() => setWarning(null), 6000);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
        setTimeout(() => setError(null), 4000);
      }
    });
  }

  function place(source: Source, reference: string, day: string, start: number, end: number) {
    runAction(() => placeBlock(mondayOf(day), source, reference, day, start, end));
  }

  function move(
    blockId: string,
    source: Source,
    reference: string,
    day: string,
    start: number,
    end: number,
    estimateContext: EstimateContext
  ) {
    runAction(() => moveBlock(mondayOf(day), blockId, source, reference, day, start, end, estimateContext));
  }

  function split(targetBlockId: string, insertSource: Source, insertReference: string, insertStart: number, insertDurationMinutes: number) {
    runAction(() => splitBlock(weekStart, targetBlockId, insertSource, insertReference, insertStart, insertDurationMinutes));
  }

  function remove(blockId: string, source: Source, reference: string, must: boolean) {
    const week = thisWeekTasks
      .flatMap((t) => t.placements)
      .find((p) => p.id === blockId);
    runAction(() => removeBlock(week ? mondayOf(week.day) : weekStart, blockId, source, reference, must));
  }

  function toggleDone(blockId: string, status: string, hours: number) {
    const placement = thisWeekTasks.flatMap((t) => t.placements).find((p) => p.id === blockId);
    const week = placement ? mondayOf(placement.day) : weekStart;
    runAction(() => (status === "done" ? markNotDone(week, blockId) : markDone(week, blockId, hours)));
  }

  function toggleMust(source: Source, reference: string, must: boolean) {
    runAction(() => setPlanMust(weekStart, source, reference, !must));
  }

  function pickEstimate(reference: string, hours: number, context: EstimateContext) {
    runAction(() => setTaskEstimate("asana", reference, hours, context));
  }

  function removeUnplaced(source: Source, reference: string) {
    runAction(() => removeFromWeek(source, reference));
  }

  function save() {
    runAction(() =>
      saveWeekPlan(
        weekStart,
        days.map((d) => ({ dateStr: d.dateStr, capacityHours: d.capacityHours, plannedCapacityHours: d.plannedCapacityHours })),
        thisWeekTasks.map((t) => ({ source: t.source, reference: t.reference, must: t.must }))
      )
    );
  }

  /** Release 1.1, brief section 10: "Copy this week's plan as plain text for pasting into Slack." */
  function copyPlan() {
    const weekDateStrs = new Set(days.map((d) => d.dateStr));
    const blocks = thisWeekTasks.flatMap((t) =>
      t.placements
        .filter((p) => weekDateStrs.has(p.day))
        .map((p) => ({ day: p.day, name: t.name, startMinutes: p.startMinutes, endMinutes: p.endMinutes, status: p.status }))
    );
    const unplaced = thisWeekTasks
      .filter((t) => t.placements.length === 0)
      .map((t) => ({ name: t.name, estimateDisplay: t.estimateDisplay }));
    const text = formatPlanAsText(
      days.map((d) => ({ dateStr: d.dateStr, label: WEEKDAY_LABELS[d.weekday], isWorkingDay: d.isWorkingDay })),
      blocks,
      unplaced
    );
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 3000);
      })
      .catch(() => setError("Couldn't copy to clipboard."));
  }

  return (
    <div>
      {error && (
        <div className="mb-2 rounded border border-danger bg-danger-tint px-2 py-1 text-xs text-chalk">{error}</div>
      )}
      {warning && (
        <div className="mb-2 rounded border border-warning bg-warning-tint px-2 py-1 text-xs text-chalk">
          {warning}
        </div>
      )}
      <div className="mb-3 flex items-center justify-end gap-2">
        {copied && <span className="text-xs text-success">Copied</span>}
        {weekStatus === "saved" && <span className="text-xs text-chalk-dim">Accepted</span>}
        <button
          onClick={copyPlan}
          className="rounded border border-border px-3 py-1 text-xs font-medium text-chalk hover:bg-surface-hover"
        >
          Copy plan
        </button>
        {weekStatus === "draft" && (
          <button
            onClick={save}
            className="rounded bg-accent px-3 py-1 text-xs font-medium text-on-accent hover:opacity-90"
          >
            Accept plan
          </button>
        )}
      </div>

      <CalendarGrid
        label="This week"
        proposedLabel={weekStatus === "draft" ? "Proposed" : null}
        days={days}
        allDays={allDays}
        thisWeekTasks={thisWeekTasks}
        shoots={shoots}
        todayStr={todayStr}
        dragging={dragging}
        setDragging={setDragging}
        onPlace={place}
        onMove={move}
        onSplit={split}
        onRemove={remove}
        onToggleDone={toggleDone}
        onToggleMust={toggleMust}
      />
      <CalendarGrid
        label="Next week"
        proposedLabel="Draft"
        days={followingDays}
        allDays={allDays}
        thisWeekTasks={thisWeekTasks}
        shoots={shoots}
        todayStr={todayStr}
        dragging={dragging}
        setDragging={setDragging}
        onPlace={place}
        onMove={move}
        onSplit={split}
        onRemove={remove}
        onToggleDone={toggleDone}
        onToggleMust={toggleMust}
      />

      <div className="mt-6">
        <h2 className="text-sm font-semibold text-chalk">Unplaced tasks</h2>
        {unplaced.length === 0 && <p className="mt-2 text-sm text-chalk-dim">Nothing unplaced.</p>}
        <ul className="mt-2 divide-y divide-border">
          {unplaced.map((task) => (
            <li
              key={`${task.source}:${task.reference}`}
              draggable
              onDragStart={() =>
                setDragging({
                  kind: "place",
                  source: task.source,
                  reference: task.reference,
                  durationMinutes: Math.max(15, Math.round(((task.estimateHours ?? 0.25) * 60) / 15) * 15),
                })
              }
              className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span>{task.name}</span>
                {task.parentName && <span className="text-xs text-chalk-dim">in {task.parentName}</span>}
                {task.stage && (
                  <span className="rounded bg-info-chip px-1.5 py-0.5 text-[10px] font-medium text-raven">
                    {task.stage}
                  </span>
                )}
                {task.priority && (
                  <span className="rounded bg-warning-chip px-1.5 py-0.5 text-[10px] font-medium text-raven">
                    {task.priority}
                  </span>
                )}
                {task.dueOn && <span className="text-xs text-chalk-dim">due {task.dueOn}</span>}
                <span className="text-xs text-chalk-dim">{task.estimateDisplay}</span>
                {task.source === "asana" && task.estimateAmbiguousOptions && task.estimateAmbiguousOptions.length > 0 && (
                  <span className="flex items-center gap-1">
                    {task.estimateAmbiguousOptions.map((option) => (
                      <button
                        key={option.variant}
                        onClick={() =>
                          pickEstimate(task.reference, option.hours, {
                            stage: task.stage,
                            focusType: task.focusType,
                            videoType: task.videoType,
                          })
                        }
                        className="rounded border border-info-chip bg-info-chip px-1.5 py-0.5 text-[10px] text-raven hover:opacity-90"
                      >
                        {option.hours}h ({option.variant})
                      </button>
                    ))}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-xs text-chalk-dim">
                  <input
                    type="checkbox"
                    checked={task.must}
                    onChange={() => toggleMust(task.source, task.reference, task.must)}
                    className="h-3.5 w-3.5"
                  />
                  Must
                </label>
                <PlacementPicker task={task} allDays={allDays} onPlace={place} />
                <button
                  onClick={() => removeUnplaced(task.source, task.reference)}
                  className="text-xs text-chalk-dim hover:text-danger"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Proposal decision 4: a tap-only alternative to dragging — pick day/time/duration directly. */
function PlacementPicker({
  task,
  allDays,
  onPlace,
}: {
  task: PlannerTask;
  allDays: DayCapacityView[];
  onPlace: (source: Source, reference: string, day: string, start: number, end: number) => void;
}) {
  const workingDays = allDays.filter((d) => d.isWorkingDay);
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(workingDays[0]?.dateStr ?? "");
  const defaultDurationMinutes = Math.max(15, Math.round(((task.estimateHours ?? 0.25) * 60) / 15) * 15);
  const [start, setStart] = useState<number | null>(null);
  const [duration, setDuration] = useState(defaultDurationMinutes);

  const dayView = workingDays.find((d) => d.dateStr === day);
  const options = dayView ? timeOptions(dayView.windowStartMinutes, dayView.windowEndMinutes) : [];
  const startValue = start ?? options[0] ?? 0;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded border border-border px-1.5 py-0.5 text-[10px] text-chalk-dim hover:bg-surface-hover"
      >
        Place…
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1 rounded border border-border bg-slate p-1 text-[10px] text-chalk">
      <select value={day} onChange={(e) => setDay(e.target.value)} className="rounded border border-border bg-slate px-0.5 text-chalk">
        {workingDays.map((d) => (
          <option key={d.dateStr} value={d.dateStr}>
            {WEEKDAY_LABELS[d.weekday]} {d.dateStr}
          </option>
        ))}
      </select>
      <select value={startValue} onChange={(e) => setStart(Number(e.target.value))} className="rounded border border-border bg-slate px-0.5 text-chalk">
        {options.map((m) => (
          <option key={m} value={m}>
            {formatHHMM(m)}
          </option>
        ))}
      </select>
      <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="rounded border border-border bg-slate px-0.5 text-chalk">
        {[15, 30, 45, 60, 90, 120, 180, 240, 300, 360, 420, 480].map((d) => (
          <option key={d} value={d}>
            {(d / 60).toFixed(2).replace(/\.?0+$/, "")}h
          </option>
        ))}
      </select>
      <button
        onClick={() => {
          onPlace(task.source, task.reference, day, startValue, startValue + duration);
          setOpen(false);
        }}
        className="rounded bg-accent px-1.5 py-0.5 text-on-accent"
      >
        Place
      </button>
      <button onClick={() => setOpen(false)} className="text-chalk-dim">
        Cancel
      </button>
    </div>
  );
}
