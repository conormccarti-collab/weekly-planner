"use client";

import { useState } from "react";
import type { PlannerTask, Placement } from "@/lib/planner-types";
import type { DayCapacityView } from "@/lib/calendar/week-capacity";
import { WEEKDAY_LABELS } from "@/lib/settings";
import { formatHHMM } from "@/lib/time";
import { DayStartBadge } from "@/components/day-start-badge";
import type { ShootMarker } from "@/lib/asana/shoots";
import { brandColorsFor } from "@/lib/brand-colors";

const PX_PER_MINUTE = 1.2;

export type Dragging =
  | { kind: "place"; source: "asana" | "personal"; reference: string; durationMinutes: number }
  | { kind: "move"; blockId: string; source: "asana" | "personal"; reference: string; durationMinutes: number };

type BlockEntry = { task: PlannerTask; placement: Placement };

function formatHours(h: number): string {
  return `${h.toFixed(1)}h`;
}

function timeOptions(windowStart: number, windowEnd: number): number[] {
  const options: number[] = [];
  for (let m = windowStart; m < windowEnd; m += 15) options.push(m);
  return options;
}

export function CalendarGrid({
  label,
  proposedLabel,
  days,
  allDays,
  thisWeekTasks,
  shoots,
  todayStr,
  dragging,
  setDragging,
  onPlace,
  onMove,
  onSplit,
  onRemove,
  onToggleDone,
  onToggleMust,
  onConfirmSuggested,
  onApproveDraft,
}: {
  label: string;
  /** v3 (plan-first): "Proposed" (this week, not yet accepted) or "Draft" (next week) — null once accepted. */
  proposedLabel?: string | null;
  days: DayCapacityView[];
  allDays: DayCapacityView[];
  thisWeekTasks: PlannerTask[];
  shoots: ShootMarker[];
  todayStr: string;
  dragging: Dragging | null;
  setDragging: (d: Dragging | null) => void;
  onPlace: (source: "asana" | "personal", reference: string, day: string, start: number, end: number) => void;
  onMove: (
    blockId: string,
    source: "asana" | "personal",
    reference: string,
    day: string,
    start: number,
    end: number,
    estimateContext: { stage: string | null; focusType: string | null; videoType: string | null }
  ) => void;
  onSplit: (targetBlockId: string, insertSource: "asana" | "personal", insertReference: string, insertStart: number, insertDurationMinutes: number) => void;
  onRemove: (blockId: string, source: "asana" | "personal", reference: string, must: boolean) => void;
  onToggleDone: (blockId: string, status: string, hours: number) => void;
  onToggleMust: (source: "asana" | "personal", reference: string, must: boolean) => void;
  onConfirmSuggested: (
    blockId: string,
    source: "asana" | "personal",
    reference: string,
    estimateContext: { stage: string | null; focusType: string | null; videoType: string | null }
  ) => void;
  /** v4 Stage 2, brief 5.5: approve a single proposed/draft block without accepting the whole week. */
  onApproveDraft: (blockId: string) => void;
}) {
  const workingDays = days.filter((d) => d.isWorkingDay);
  const [expandedBlockId, setExpandedBlockId] = useState<string | null>(null);
  // v5 Stage 12e.2: "Show a drop-target highlight and a ghost of the
  // block." Local, visual-only state — cleared on drop/leave, never
  // triggers a refetch. Only updated when the snapped-to-15-min value
  // actually changes, so a drag doesn't re-render on every pixel of mouse
  // movement.
  const [dragOver, setDragOver] = useState<{ day: string; startMinutes: number } | null>(null);

  const blocksByDay = new Map<string, BlockEntry[]>();
  const weekDateStrs = new Set(days.map((d) => d.dateStr));
  for (const task of thisWeekTasks) {
    for (const placement of task.placements) {
      if (!weekDateStrs.has(placement.day)) continue;
      const list = blocksByDay.get(placement.day) ?? [];
      list.push({ task, placement });
      blocksByDay.set(placement.day, list);
    }
  }

  const shootsByDay = new Map<string, ShootMarker[]>();
  for (const shoot of shoots) {
    if (!weekDateStrs.has(shoot.dateStr)) continue;
    const list = shootsByDay.get(shoot.dateStr) ?? [];
    list.push(shoot);
    shootsByDay.set(shoot.dateStr, list);
  }

  function blockedBandsFor(day: DayCapacityView): { startMinutes: number; endMinutes: number }[] {
    const bands: { startMinutes: number; endMinutes: number }[] = [];
    let cursor = day.windowStartMinutes;
    for (const free of [...day.freeBlocks].sort((a, b) => a.startMinutes - b.startMinutes)) {
      if (free.startMinutes > cursor) bands.push({ startMinutes: cursor, endMinutes: free.startMinutes });
      cursor = Math.max(cursor, free.endMinutes);
    }
    if (cursor < day.windowEndMinutes) bands.push({ startMinutes: cursor, endMinutes: day.windowEndMinutes });
    return bands;
  }

  /** Hour marks within a day's window, for the time ruler. */
  function hourMarksFor(day: DayCapacityView): number[] {
    const marks: number[] = [];
    const firstHour = Math.ceil(day.windowStartMinutes / 60) * 60;
    for (let m = firstHour; m < day.windowEndMinutes; m += 60) marks.push(m);
    return marks;
  }

  function dropMinutes(e: React.DragEvent<HTMLDivElement>, day: DayCapacityView): number {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const raw = day.windowStartMinutes + y / PX_PER_MINUTE;
    return Math.round(raw / 15) * 15;
  }

  return (
    <div className="mb-6">
      <h2 className="mb-2 text-sm font-semibold text-chalk">
        {label}
        {proposedLabel && <span className="ml-2 rounded bg-warning-chip px-1.5 py-0.5 text-[10px] font-medium text-raven">{proposedLabel}</span>}
      </h2>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
        {workingDays.map((day) => {
          const windowHeight = (day.windowEndMinutes - day.windowStartMinutes) * PX_PER_MINUTE;
          const blocks = blocksByDay.get(day.dateStr) ?? [];
          const planned = blocks.reduce((sum, b) => sum + b.placement.hours, 0);
          const over = planned > day.plannedCapacityHours;
          return (
            <div key={day.dateStr} className={`rounded border ${over ? "border-danger" : "border-border"}`}>
              <div
                className={`flex items-center justify-between border-b border-border px-2 py-1 ${
                  day.dateStr === todayStr ? "bg-info-tint" : "bg-slate"
                }`}
              >
                <span className="text-xs font-medium text-chalk">{WEEKDAY_LABELS[day.weekday]}</span>
                {day.dateStr === todayStr ? (
                  <DayStartBadge day={day} />
                ) : (
                  <span className="text-[10px] text-chalk-dim">from {day.startLabel}</span>
                )}
              </div>
              <div className={`px-2 py-0.5 text-[10px] ${over ? "font-medium text-danger" : "text-chalk-dim"}`}>
                {formatHours(planned)} / {formatHours(day.plannedCapacityHours)}
              </div>
              {(shootsByDay.get(day.dateStr) ?? []).map((shoot) => (
                <div
                  key={shoot.gid}
                  title={[shoot.shootType, shoot.location].filter(Boolean).join(" · ") || undefined}
                  className="truncate border-b border-warning bg-warning-tint px-2 py-0.5 text-[10px] text-chalk"
                >
                  Shoot: {shoot.name}
                  {(shoot.shootType || shoot.location) && (
                    <span className="text-chalk"> ({[shoot.shootType, shoot.location].filter(Boolean).join(", ")})</span>
                  )}
                  {shoot.matchedEventTitle && <span className="text-chalk"> · {shoot.matchedEventTitle}</span>}
                </div>
              ))}
              <div
                className={`relative ${dragOver?.day === day.dateStr ? "bg-surface-hover" : ""}`}
                style={{ height: windowHeight }}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!dragging) return;
                  const start = dropMinutes(e, day);
                  if (dragOver?.day !== day.dateStr || dragOver?.startMinutes !== start) {
                    setDragOver({ day: day.dateStr, startMinutes: start });
                  }
                }}
                onDragLeave={(e) => {
                  // Only clear when truly leaving this column, not just
                  // moving between its own child elements (which also fire
                  // dragleave) — relatedTarget stays inside on those.
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                    setDragOver((prev) => (prev?.day === day.dateStr ? null : prev));
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(null);
                  if (!dragging) return;
                  const start = dropMinutes(e, day);
                  const end = start + dragging.durationMinutes;
                  if (dragging.kind === "place") {
                    onPlace(dragging.source, dragging.reference, day.dateStr, start, end);
                  } else {
                    const task = thisWeekTasks.find((t) => t.source === dragging.source && t.reference === dragging.reference);
                    onMove(dragging.blockId, dragging.source, dragging.reference, day.dateStr, start, end, {
                      stage: task?.stage ?? null,
                      focusType: task?.focusType ?? null,
                      videoType: task?.videoType ?? null,
                    });
                  }
                  setDragging(null);
                }}
              >
                {blockedBandsFor(day).map((band, i) => (
                  <div
                    key={i}
                    className="absolute inset-x-0 bg-surface-hover"
                    style={{
                      top: (band.startMinutes - day.windowStartMinutes) * PX_PER_MINUTE,
                      height: (band.endMinutes - band.startMinutes) * PX_PER_MINUTE,
                    }}
                  />
                ))}

                {hourMarksFor(day).map((m) => (
                  <div
                    key={m}
                    className="pointer-events-none absolute inset-x-0 border-t border-border/40"
                    style={{ top: (m - day.windowStartMinutes) * PX_PER_MINUTE }}
                  >
                    <span className="absolute left-0 top-0 -translate-y-1/2 bg-slate px-0.5 text-[8px] text-chalk-dim">
                      {formatHHMM(m)}
                    </span>
                  </div>
                ))}

                {blocks.map(({ task, placement }) => {
                  const top = (placement.startMinutes - day.windowStartMinutes) * PX_PER_MINUTE;
                  const height = Math.max(14, (placement.endMinutes - placement.startMinutes) * PX_PER_MINUTE);
                  const expanded = expandedBlockId === placement.id;
                  const brand = brandColorsFor(task.brand);
                  const isProposed = !!proposedLabel && !placement.pinned;
                  const isSuggested = placement.status === "suggested";
                  return (
                    <div
                      key={placement.id}
                      draggable
                      onDragStart={(e) => {
                        // Some browsers need real drag data set in
                        // dragstart for drop targets elsewhere on the page
                        // to reliably receive dragover/drop at all.
                        e.dataTransfer.setData("text/plain", placement.id);
                        e.dataTransfer.effectAllowed = "move";
                        setDragging({
                          kind: "move",
                          blockId: placement.id,
                          source: task.source,
                          reference: task.reference,
                          durationMinutes: placement.endMinutes - placement.startMinutes,
                        });
                      }}
                      onDragEnd={() => {
                        // Cancelled (dropped outside any valid target) — a
                        // real drop already clears both via its own handler.
                        setDragging(null);
                        setDragOver(null);
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!dragging) return;
                        if (dragging.kind === "move" && dragging.blockId === placement.id) return;
                        if (dragging.source === task.source && dragging.reference === task.reference) return;
                        const rect = e.currentTarget.getBoundingClientRect();
                        const y = e.clientY - rect.top;
                        const insertStart = placement.startMinutes + y / PX_PER_MINUTE;
                        if (dragging.kind === "place") {
                          onSplit(placement.id, dragging.source, dragging.reference, insertStart, dragging.durationMinutes);
                        }
                        setDragging(null);
                      }}
                      onClick={() => setExpandedBlockId(expanded ? null : placement.id)}
                      title={task.parentName ? `${task.parentName} — ${task.name}` : task.name}
                      className={`absolute left-0.5 cursor-pointer select-none rounded border px-1 text-[10px] ${
                        isProposed ? "border-dashed border-warning" : "border-border"
                      } ${expanded ? "overflow-visible" : "overflow-hidden"}`}
                      style={{
                        backgroundColor: brand.tint,
                        backgroundImage: isSuggested
                          ? "repeating-linear-gradient(135deg, transparent, transparent 4px, rgba(255,255,255,0.14) 4px, rgba(255,255,255,0.14) 8px)"
                          : undefined,
                        borderLeftColor: brand.edge,
                        borderLeftWidth: 3,
                        borderLeftStyle: brand.dashed ? "dashed" : "solid",
                        // Expanded stays within the day column's own width
                        // (the `left-0.5` class plus this same `right: 2px`
                        // already bound it in both states) rather than a
                        // fixed px width wider than the column, which used
                        // to spill into the next day.
                        ...(expanded ? { top, minHeight: height, right: "2px", zIndex: 20 } : { top, height, right: "2px", zIndex: 1 }),
                      }}
                    >
                      <div className="truncate font-medium text-chalk">
                        {task.parentName ? `${task.parentName} — ${task.name}` : task.name}
                        {placement.isFinal && (
                          <span title="This task's last block this week" className="ml-1 rounded bg-slate px-1 text-[8px] text-chalk">
                            final
                          </span>
                        )}
                        {isSuggested && <span className="ml-1 rounded bg-warning-chip px-1 text-[8px] text-raven">suggested</span>}
                        {task.isBlocked && (
                          <span title="Still waiting on a blocker" className="ml-1 rounded bg-danger-tint px-1 text-[8px] text-danger">
                            blocked
                          </span>
                        )}
                      </div>
                      <div className="truncate text-chalk">
                        {formatHHMM(placement.startMinutes)}–{formatHHMM(placement.endMinutes)} · {brand.label}
                        {placement.status === "done" && " ✓"}
                      </div>
                      {expanded && (
                        <BlockEditor
                          task={task}
                          placement={placement}
                          isProposed={isProposed}
                          allDays={allDays}
                          onMove={onMove}
                          onRemove={onRemove}
                          onToggleDone={onToggleDone}
                          onToggleMust={onToggleMust}
                          onConfirmSuggested={onConfirmSuggested}
                          onApproveDraft={onApproveDraft}
                          onClose={() => setExpandedBlockId(null)}
                        />
                      )}
                    </div>
                  );
                })}

                {dragging && dragOver?.day === day.dateStr && (
                  <div
                    className="pointer-events-none absolute left-0.5 right-0.5 rounded border-2 border-dashed border-info bg-info-tint/50"
                    style={{
                      top: (dragOver.startMinutes - day.windowStartMinutes) * PX_PER_MINUTE,
                      height: Math.max(14, dragging.durationMinutes * PX_PER_MINUTE),
                      zIndex: 30,
                    }}
                  >
                    <span className="block truncate px-1 text-[9px] font-medium text-chalk">
                      {formatHHMM(dragOver.startMinutes)}–{formatHHMM(dragOver.startMinutes + dragging.durationMinutes)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BlockEditor({
  task,
  placement,
  isProposed,
  allDays,
  onMove,
  onRemove,
  onToggleDone,
  onToggleMust,
  onConfirmSuggested,
  onApproveDraft,
  onClose,
}: {
  task: PlannerTask;
  placement: Placement;
  isProposed: boolean;
  allDays: DayCapacityView[];
  onMove: (
    blockId: string,
    source: "asana" | "personal",
    reference: string,
    day: string,
    start: number,
    end: number,
    estimateContext: { stage: string | null; focusType: string | null; videoType: string | null }
  ) => void;
  onRemove: (blockId: string, source: "asana" | "personal", reference: string, must: boolean) => void;
  onToggleDone: (blockId: string, status: string, hours: number) => void;
  onToggleMust: (source: "asana" | "personal", reference: string, must: boolean) => void;
  onConfirmSuggested: (
    blockId: string,
    source: "asana" | "personal",
    reference: string,
    estimateContext: { stage: string | null; focusType: string | null; videoType: string | null }
  ) => void;
  onApproveDraft: (blockId: string) => void;
  onClose: () => void;
}) {
  const [day, setDay] = useState(placement.day);
  const [start, setStart] = useState(placement.startMinutes);
  const [duration, setDuration] = useState(placement.endMinutes - placement.startMinutes);

  const dayView = allDays.find((d) => d.dateStr === day);
  const options = dayView ? timeOptions(dayView.windowStartMinutes, dayView.windowEndMinutes) : [];
  // The block's real duration must always be a selectable option, even when
  // it isn't one of the round presets (e.g. 3.5h/210min) — otherwise the
  // select shows no matching option (defaulting visually to the first one,
  // 0.25h) while the real value sits unseen underneath.
  const durationOptions = [...new Set([15, 30, 45, 60, 90, 120, 180, 240, 300, 360, 420, 480, duration])].sort((a, b) => a - b);

  function save() {
    onMove(placement.id, task.source, task.reference, day, start, start + duration, {
      stage: task.stage,
      focusType: task.focusType,
      videoType: task.videoType,
    });
    onClose();
  }

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      draggable={false}
      onDragStart={(e) => e.preventDefault()}
      className="mt-1 space-y-1 rounded border border-border bg-slate p-1 text-[10px] text-chalk shadow"
    >
      <div className="flex flex-col gap-1">
        <select value={day} onChange={(e) => setDay(e.target.value)} className="w-full rounded border border-border bg-slate px-0.5 text-chalk">
          {allDays
            .filter((d) => d.isWorkingDay)
            .map((d) => (
              <option key={d.dateStr} value={d.dateStr}>
                {d.dateStr}
              </option>
            ))}
        </select>
        <select
          value={start}
          onChange={(e) => setStart(Number(e.target.value))}
          className="w-full rounded border border-border bg-slate px-0.5 text-chalk"
        >
          {options.map((m) => (
            <option key={m} value={m}>
              {formatHHMM(m)}
            </option>
          ))}
        </select>
        <select
          value={duration}
          onChange={(e) => setDuration(Number(e.target.value))}
          className="w-full rounded border border-border bg-slate px-0.5 text-chalk"
        >
          {durationOptions.map((d) => (
            <option key={d} value={d}>
              {(d / 60).toFixed(2).replace(/\.?0+$/, "")}h
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <button onClick={save} className="rounded bg-accent px-1.5 py-0.5 text-on-accent">
          Save
        </button>
        {placement.status === "suggested" && (
          <button
            onClick={() => {
              onConfirmSuggested(placement.id, task.source, task.reference, {
                stage: task.stage,
                focusType: task.focusType,
                videoType: task.videoType,
              });
              onClose();
            }}
            className="rounded border border-border px-1.5 py-0.5 text-chalk hover:bg-surface-hover"
          >
            Confirm
          </button>
        )}
        {isProposed && (
          <button
            onClick={() => {
              onApproveDraft(placement.id);
              onClose();
            }}
            className="rounded border border-border px-1.5 py-0.5 text-chalk hover:bg-surface-hover"
          >
            Approve
          </button>
        )}
        <label className="flex items-center gap-0.5">
          <input
            type="checkbox"
            checked={placement.status === "done"}
            onChange={() =>
              onToggleDone(placement.id, placement.status, placement.actualHours ?? placement.hours)
            }
            className="h-3 w-3"
          />
          Done
        </label>
        <label className="flex items-center gap-0.5">
          <input
            type="checkbox"
            checked={task.must}
            onChange={() => onToggleMust(task.source, task.reference, task.must)}
            className="h-3 w-3"
          />
          Must
        </label>
        <button
          onClick={() => onRemove(placement.id, task.source, task.reference, task.must)}
          className="ml-auto text-chalk-dim hover:text-danger"
        >
          {isProposed ? "Reject" : "Remove"}
        </button>
      </div>
    </div>
  );
}
