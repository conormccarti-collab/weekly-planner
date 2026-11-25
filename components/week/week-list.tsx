"use client";

import { useState, useTransition } from "react";
import {
  placeBlock,
  moveBlock,
  removeBlock,
  removeFromWeek,
  setPlanMust,
  markDoneAndCloseGap,
  markNotDone,
  confirmSuggestedEstimate,
  approveDraftBlock,
  undoReject,
  splitBlock,
  reprioritiseFromDay,
  fillSlack,
} from "@/app/(app)/plan/actions";
import { refreshDraftWeek } from "@/app/(app)/plan/build-actions";
import { setTaskEstimate } from "@/app/(app)/tasks/actions";
import { dismissReminder } from "@/app/(app)/reminders/actions";
import type { CheckoffReminder } from "@/lib/reminders";
import type { PlannerTask, Placement } from "@/lib/planner-types";
import type { DayCapacityView } from "@/lib/calendar/week-capacity";
import type { ShootMarker } from "@/lib/asana/shoots";
import { mondayOf, parseHHMM } from "@/lib/time";
import { formatPlanAsText } from "@/lib/plan-text";
import { WEEKDAY_LABELS } from "@/lib/settings";
import { WeekTabs } from "@/components/week/week-tabs";
import { StatsStrip } from "@/components/week/stats-strip";
import { DayCard, type DayRowItem } from "@/components/week/day-card";
import { UnscheduledQueue } from "@/components/week/unscheduled-queue";
import { EditEntryModal } from "@/components/week/edit-entry-modal";
import { PlaceModal } from "@/components/week/place-modal";
import { SplitModal } from "@/components/week/split-modal";

type Source = "asana" | "personal";
type EstimateContext = { stage: string | null; focusType: string | null; videoType: string | null };
type RemainderDestination = { kind: "next-working-day" } | { kind: "queue" };

export function WeekList({
  weekStart,
  followingWeekStart,
  todayStr,
  days,
  followingDays,
  thisWeekTasks,
  shoots,
  rejectedKeys = new Set(),
  weekCapacityHours,
  weekPlannedHours,
  weekCompletedHours,
  checkoffs = [],
}: {
  weekStart: string;
  followingWeekStart: string;
  todayStr: string;
  days: DayCapacityView[];
  followingDays: DayCapacityView[];
  thisWeekTasks: PlannerTask[];
  shoots: ShootMarker[];
  rejectedKeys?: Set<string>;
  weekCapacityHours: number;
  weekPlannedHours: number;
  weekCompletedHours: number;
  checkoffs?: CheckoffReminder[];
}) {
  const [pending, startTransition] = useTransition();
  const [tab, setTab] = useState<"this" | "next">("this");
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [reprioritisingDay, setReprioritisingDay] = useState<string | null>(null);
  const [removedBlock, setRemovedBlock] = useState<
    { source: Source; reference: string; name: string; weekStart: string; must: boolean; day: string; startMinutes: number; endMinutes: number } | null
  >(null);

  const [editing, setEditing] = useState<{ task: PlannerTask; placement: Placement } | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [placing, setPlacing] = useState<{ task: PlannerTask; initialDay?: string } | null>(null);
  const [addingToDay, setAddingToDay] = useState<string | null>(null);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [splitting, setSplitting] = useState<{ task: PlannerTask; placement: Placement } | null>(null);
  const [splitError, setSplitError] = useState<string | null>(null);

  const allDays = [...days, ...followingDays];
  const activeDays = tab === "this" ? days : followingDays;
  const activeWeekStart = tab === "this" ? weekStart : followingWeekStart;
  const unplaced = thisWeekTasks.filter((t) => t.placements.length === 0);

  function runAction<T>(action: () => Promise<T>, onResult?: (result: T) => void) {
    startTransition(async () => {
      try {
        const result = await action();
        const w = (result as { warning?: string } | undefined)?.warning;
        if (w) {
          setWarning(w);
          setTimeout(() => setWarning(null), 6000);
        }
        onResult?.(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
        setTimeout(() => setError(null), 4000);
      }
    });
  }

  function rowsForDay(day: DayCapacityView): DayRowItem[] {
    const rows: DayRowItem[] = [];
    for (const task of thisWeekTasks) {
      for (const placement of task.placements) {
        if (placement.day !== day.dateStr) continue;
        rows.push({ kind: "placement", sortMinutes: placement.startMinutes, task, placement });
      }
    }
    for (const event of day.events) {
      if (event.allDay) continue; // shown as a day-level note would be a future refinement; skip for now rather than mis-sort it
      rows.push({ kind: "event", sortMinutes: event.startLabel ? parseHHMM(event.startLabel) : 0, event });
    }
    if (day.lunchInterval) {
      rows.push({
        kind: "lunch",
        sortMinutes: day.lunchInterval.startMinutes,
        startMinutes: day.lunchInterval.startMinutes,
        endMinutes: day.lunchInterval.endMinutes,
      });
    }
    return rows;
  }

  function openEdit(task: PlannerTask, placement: Placement) {
    setEditError(null);
    setEditing({ task, placement });
  }

  function saveEdit(blockId: string, source: Source, reference: string, day: string, start: number, end: number, estimateContext: EstimateContext) {
    setEditError(null);
    startTransition(async () => {
      try {
        await moveBlock(mondayOf(day), blockId, source, reference, day, start, end, estimateContext);
        setEditing(null);
      } catch (err) {
        setEditError(err instanceof Error ? err.message : "Couldn't save that change.");
      }
    });
  }

  function openPlace(task: PlannerTask, initialDay?: string) {
    setPlaceError(null);
    setPlacing({ task, initialDay });
  }

  function place(source: Source, reference: string, day: string, start: number, end: number) {
    setPlaceError(null);
    startTransition(async () => {
      try {
        await placeBlock(mondayOf(day), source, reference, day, start, end);
        setPlacing(null);
      } catch (err) {
        setPlaceError(err instanceof Error ? err.message : "Couldn't place that task.");
      }
    });
  }

  function openSplit(task: PlannerTask, placement: Placement) {
    setSplitError(null);
    setSplitting({ task, placement });
    setEditing(null);
  }

  function doSplit(blockId: string, source: Source, reference: string, hoursNow: number, remainder: RemainderDestination) {
    setSplitError(null);
    startTransition(async () => {
      try {
        await splitBlock(blockId, source, reference, hoursNow, remainder);
        setSplitting(null);
      } catch (err) {
        setSplitError(err instanceof Error ? err.message : "Couldn't split that task.");
      }
    });
  }

  function remove(blockId: string, source: Source, reference: string, must: boolean) {
    const task = thisWeekTasks.find((t) => t.placements.some((p) => p.id === blockId));
    const placement = task?.placements.find((p) => p.id === blockId);
    const removeWeekStart = placement ? mondayOf(placement.day) : weekStart;
    runAction(
      () => removeBlock(removeWeekStart, blockId, source, reference, must),
      (result) => {
        setEditing(null);
        if (result?.removedSlot) {
          setRemovedBlock({ source, reference, name: task?.name ?? "Task", weekStart: removeWeekStart, must, ...result.removedSlot });
          setTimeout(() => setRemovedBlock(null), 8000);
        }
      }
    );
  }

  function undoRemove() {
    if (!removedBlock) return;
    const { source, reference, weekStart: ws, day, startMinutes, endMinutes, must } = removedBlock;
    setRemovedBlock(null);
    runAction(() => undoReject(ws, source, reference, day, startMinutes, endMinutes, must));
  }

  function toggleDone(blockId: string, status: string, hours: number) {
    runAction(() => (status === "done" ? markNotDone(weekStart, blockId) : markDoneAndCloseGap(blockId, hours)));
  }

  const checkoffByReference = new Map(checkoffs.map((c) => [c.gid, c.id]));
  function dismissCheckoff(id: string) {
    runAction(() => dismissReminder(id));
  }

  function toggleMust(source: Source, reference: string, must: boolean) {
    runAction(() => setPlanMust(weekStart, source, reference, !must));
  }

  function lockBlock(blockId: string) {
    runAction(() => approveDraftBlock(blockId));
  }

  function confirmSuggested(blockId: string, source: Source, reference: string, estimateContext: EstimateContext) {
    runAction(() => confirmSuggestedEstimate(blockId, source, reference, estimateContext));
    setEditing(null);
  }

  function reprioritise(day: string) {
    setReprioritisingDay(day);
    runAction(() => reprioritiseFromDay(day), () => setReprioritisingDay(null));
  }

  function autoSchedule() {
    runAction(() => refreshDraftWeek(activeWeekStart));
  }

  function fillSlackAction() {
    runAction(
      () => fillSlack(weekStart),
      (result) => {
        const text = result.count > 0 ? `Filled ${result.filledHours.toFixed(1)}h across ${result.count} task${result.count === 1 ? "" : "s"}.` : "No slack to fill, or nothing eligible to pull forward.";
        setWarning(text);
        setTimeout(() => setWarning(null), 6000);
      }
    );
  }

  function pickEstimate(reference: string, hours: number, context: EstimateContext) {
    runAction(() => setTaskEstimate("asana", reference, hours, context));
  }

  function removeUnplaced(source: Source, reference: string) {
    runAction(() => removeFromWeek(source, reference));
  }

  function copyPlan() {
    const weekDateStrs = new Set(days.map((d) => d.dateStr));
    const blocks = thisWeekTasks.flatMap((t) =>
      t.placements.filter((p) => weekDateStrs.has(p.day)).map((p) => ({ day: p.day, name: t.name, startMinutes: p.startMinutes, endMinutes: p.endMinutes, status: p.status }))
    );
    const unplacedForCopy = thisWeekTasks.filter((t) => t.placements.length === 0).map((t) => ({ name: t.name, estimateDisplay: t.estimateDisplay }));
    const text = formatPlanAsText(
      days.map((d) => ({ dateStr: d.dateStr, label: WEEKDAY_LABELS[d.weekday], isWorkingDay: d.isWorkingDay })),
      blocks,
      unplacedForCopy
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
      {error && <div className="mb-2 rounded border border-danger bg-danger-tint px-2 py-1 text-xs text-chalk">{error}</div>}
      {warning && <div className="mb-2 rounded border border-warning bg-warning-tint px-2 py-1 text-xs text-chalk">{warning}</div>}
      {removedBlock && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded border border-border bg-surface-hover px-2 py-1 text-xs text-chalk">
          <span>
            Removed {removedBlock.name} from {removedBlock.day}.
          </span>
          <button onClick={undoRemove} className="font-medium text-info underline">
            Undo
          </button>
        </div>
      )}

      <StatsStrip
        weekPlannedHours={weekPlannedHours}
        weekCapacityHours={weekCapacityHours}
        weekCompletedHours={weekCompletedHours}
        days={days}
        unscheduledCount={unplaced.length}
        unscheduledHours={unplaced.reduce((sum, t) => sum + (t.estimateHours ?? 0), 0)}
      />

      <div className="mb-3 flex items-center justify-between">
        <WeekTabs active={tab} onChange={setTab} />
        {copied && <span className="text-xs text-success">Copied</span>}
        <button onClick={copyPlan} className="rounded border border-border px-3 py-1 text-xs font-medium text-chalk hover:bg-surface-hover">
          Copy plan
        </button>
      </div>

      <div className="space-y-3">
        {activeDays
          // A locked date stays visible (with its "Out of office" badge and
          // lock control) even though getWeekCapacity reports isWorkingDay:
          // false for it — only an ordinary non-working day (weekend) is
          // hidden here.
          .filter((d) => d.isWorkingDay || d.isLocked)
          .map((day) => (
            <DayCard
              key={day.dateStr}
              day={day}
              rows={rowsForDay(day)}
              shoots={shoots.filter((s) => s.dateStr === day.dateStr)}
              isToday={day.dateStr === todayStr}
              onToggleDone={toggleDone}
              onToggleMust={toggleMust}
              onEdit={openEdit}
              onSplit={openSplit}
              onRemove={remove}
              onLock={lockBlock}
              checkoffByReference={checkoffByReference}
              onDismissCheckoff={dismissCheckoff}
              onAddBlock={() => setAddingToDay(day.dateStr)}
              onReprioritise={() => reprioritise(day.dateStr)}
              reprioritisePending={reprioritisingDay === day.dateStr}
            />
          ))}
      </div>

      <div className="mt-4">
        <UnscheduledQueue
          tasks={unplaced}
          rejectedKeys={rejectedKeys}
          pending={pending}
          onToggleMust={toggleMust}
          onPlace={(task) => openPlace(task)}
          onRemove={removeUnplaced}
          onPickEstimate={pickEstimate}
          onAutoSchedule={autoSchedule}
          onFillSlack={fillSlackAction}
        />
      </div>

      {addingToDay && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4" onClick={() => setAddingToDay(null)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm space-y-2 rounded-2xl border border-border bg-slate p-4 text-sm text-chalk shadow-xl"
          >
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-semibold text-chalk">Add to {addingToDay}</h3>
              <button onClick={() => setAddingToDay(null)} className="text-chalk-dim hover:text-chalk">
                ✕
              </button>
            </div>
            {unplaced.length === 0 ? (
              <p className="text-xs text-chalk-dim">Nothing unscheduled to add — everything's already on the calendar.</p>
            ) : (
              <ul className="max-h-64 divide-y divide-border overflow-y-auto">
                {unplaced.map((task) => (
                  <li key={`${task.source}:${task.reference}`}>
                    <button
                      onClick={() => {
                        const day = addingToDay;
                        setAddingToDay(null);
                        openPlace(task, day);
                      }}
                      className="w-full py-2 text-left text-xs text-chalk hover:text-info"
                    >
                      {task.parentName ? `${task.parentName} — ${task.name}` : task.name}{" "}
                      <span className="text-chalk-dim">{task.estimateDisplay}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {editing && (
        <EditEntryModal
          task={editing.task}
          placement={editing.placement}
          allDays={allDays}
          pending={pending}
          error={editError}
          onMove={saveEdit}
          onRemove={remove}
          onToggleMust={toggleMust}
          onConfirmSuggested={confirmSuggested}
          onOpenSplit={() => openSplit(editing.task, editing.placement)}
          onClose={() => setEditing(null)}
        />
      )}

      {placing && (
        <PlaceModal
          task={placing.task}
          allDays={allDays}
          initialDay={placing.initialDay}
          pending={pending}
          error={placeError}
          onPlace={place}
          onClose={() => setPlacing(null)}
        />
      )}

      {splitting && (
        <SplitModal task={splitting.task} placement={splitting.placement} pending={pending} error={splitError} onSplit={doSplit} onClose={() => setSplitting(null)} />
      )}
    </div>
  );
}
