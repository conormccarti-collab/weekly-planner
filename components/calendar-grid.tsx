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
}) {
  const workingDays = days.filter((d) => d.isWorkingDay);
  const [expandedBlockId, setExpandedBlockId] = useState<string | null>(null);

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
                </div>
              ))}
              <div
                className="relative"
                style={{ height: windowHeight }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
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

                {blocks.map(({ task, placement }) => {
                  const top = (placement.startMinutes - day.windowStartMinutes) * PX_PER_MINUTE;
                  const height = Math.max(14, (placement.endMinutes - placement.startMinutes) * PX_PER_MINUTE);
                  const expanded = expandedBlockId === placement.id;
                  const brand = brandColorsFor(task.brand);
                  const isProposed = !!proposedLabel && !placement.pinned;
                  const isProvisional = placement.status === "provisional";
                  return (
                    <div
                      key={placement.id}
                      draggable
                      onDragStart={() =>
                        setDragging({
                          kind: "move",
                          blockId: placement.id,
                          source: task.source,
                          reference: task.reference,
                          durationMinutes: placement.endMinutes - placement.startMinutes,
                        })
                      }
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
                      className={`absolute left-0.5 cursor-pointer rounded border px-1 text-[10px] ${
                        isProposed ? "border-dashed border-warning" : "border-border"
                      } ${expanded ? "overflow-visible" : "overflow-hidden"}`}
                      style={{
                        backgroundColor: brand.tint,
                        backgroundImage: isProvisional
                          ? "repeating-linear-gradient(135deg, transparent, transparent 4px, rgba(255,255,255,0.14) 4px, rgba(255,255,255,0.14) 8px)"
                          : undefined,
                        borderLeftColor: brand.edge,
                        borderLeftWidth: 3,
                        borderLeftStyle: brand.dashed ? "dashed" : "solid",
                        ...(expanded
                          ? { top, minHeight: height, width: 160, zIndex: 20 }
                          : { top, height, right: "2px", zIndex: 1 }),
                      }}
                    >
                      <div className="truncate font-medium text-chalk">
                        {task.name}
                        {placement.isFinal && <span className="ml-1 rounded bg-slate px-1 text-[8px] text-chalk">final</span>}
                        {isProvisional && <span className="ml-1 rounded bg-warning-chip px-1 text-[8px] text-raven">needs estimate</span>}
                      </div>
                      <div className="truncate text-chalk">
                        {formatHHMM(placement.startMinutes)}–{formatHHMM(placement.endMinutes)} · {brand.label}
                        {placement.status === "done" && " ✓"}
                      </div>
                      {expanded && (
                        <BlockEditor
                          task={task}
                          placement={placement}
                          allDays={allDays}
                          onMove={onMove}
                          onRemove={onRemove}
                          onToggleDone={onToggleDone}
                          onToggleMust={onToggleMust}
                          onClose={() => setExpandedBlockId(null)}
                        />
                      )}
                    </div>
                  );
                })}
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
  allDays,
  onMove,
  onRemove,
  onToggleDone,
  onToggleMust,
  onClose,
}: {
  task: PlannerTask;
  placement: Placement;
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
  onClose: () => void;
}) {
  const [day, setDay] = useState(placement.day);
  const [start, setStart] = useState(placement.startMinutes);
  const [duration, setDuration] = useState(placement.endMinutes - placement.startMinutes);

  const dayView = allDays.find((d) => d.dateStr === day);
  const options = dayView ? timeOptions(dayView.windowStartMinutes, dayView.windowEndMinutes) : [];

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
          {[15, 30, 45, 60, 90, 120, 180, 240, 300, 360, 420, 480].map((d) => (
            <option key={d} value={d}>
              {(d / 60).toFixed(2).replace(/\.?0+$/, "")}h
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center justify-between gap-1">
        <button onClick={save} className="rounded bg-accent px-1.5 py-0.5 text-on-accent">
          Save
        </button>
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
          className="text-chalk-dim hover:text-danger"
        >
          Remove
        </button>
      </div>
    </div>
  );
}
