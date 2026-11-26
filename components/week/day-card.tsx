"use client";

import type { PlannerTask, Placement } from "@/lib/planner-types";
import type { DayCapacityView } from "@/lib/calendar/week-capacity";
import { WEEKDAY_LABELS } from "@/lib/settings";
import { DayStartBadge } from "@/components/day-start-badge";
import { LunchOverrideBadge } from "@/components/lunch-override-badge";
import { DayLockControl } from "@/components/day-lock-control";
import { EntryRow } from "@/components/week/entry-row";
import type { ShootMarker } from "@/lib/asana/shoots";

type Source = "asana" | "personal";

export type DayRowItem =
  | { kind: "placement"; sortMinutes: number; task: PlannerTask; placement: Placement }
  | { kind: "event"; sortMinutes: number; event: DayCapacityView["events"][number] }
  | { kind: "lunch"; sortMinutes: number; startMinutes: number; endMinutes: number };

function formatHours(h: number): string {
  return `${h.toFixed(1)}h`;
}

/**
 * One day's module — the mockup's "day card": a header with the date, the
 * day's hours total vs capacity, an editable start time and lunch time, a
 * Re-prioritise button and a + Block button, then a plain ordered list of
 * entries below. Replaces CalendarGrid's pixel-positioned hour column.
 */
export function DayCard({
  day,
  rows,
  shoots,
  isToday,
  onToggleDone,
  onToggleMust,
  onEdit,
  onSplit,
  onRemove,
  onLock,
  onStart,
  onAddBlock,
  onReprioritise,
  reprioritisePending,
  checkoffByReference,
  onDismissCheckoff,
}: {
  day: DayCapacityView;
  rows: DayRowItem[];
  shoots: ShootMarker[];
  isToday: boolean;
  onToggleDone: (blockId: string, status: string, hours: number) => void;
  onToggleMust: (source: Source, reference: string, must: boolean) => void;
  onEdit: (task: PlannerTask, placement: Placement) => void;
  onSplit: (task: PlannerTask, placement: Placement) => void;
  onRemove: (blockId: string, source: Source, reference: string, must: boolean) => void;
  onLock: (blockId: string) => void;
  onStart: (blockId: string) => void;
  onAddBlock: () => void;
  onReprioritise: () => void;
  reprioritisePending: boolean;
  /** gid -> reminder id, for the "check it off in Asana too" tick next to a done task. */
  checkoffByReference: Map<string, string>;
  onDismissCheckoff: (id: string) => void;
}) {
  const plannedHours = rows.reduce((sum, r) => (r.kind === "placement" ? sum + r.placement.hours : sum), 0);
  const over = plannedHours > day.plannedCapacityHours;
  const sorted = [...rows].sort((a, b) => a.sortMinutes - b.sortMinutes);

  return (
    <section
      data-day-card={day.dateStr}
      data-window-start={day.windowStartMinutes}
      data-window-end={day.windowEndMinutes}
      className={`rounded-2xl border shadow-sm ${isToday ? "border-info" : "border-border"} bg-slate`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-chalk">
            {WEEKDAY_LABELS[day.weekday]} {day.dateStr}
          </h3>
          {isToday && <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold uppercase text-on-accent">Today</span>}
          {day.isLocked && (
            <span className="rounded bg-danger-tint px-1.5 py-0.5 text-[10px] font-semibold uppercase text-danger" title={day.lockedReason ?? undefined}>
              Out of office
            </span>
          )}
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${over ? "bg-danger-tint text-danger" : "bg-surface-hover text-chalk-dim"}`}>
            {formatHours(plannedHours)} / {formatHours(day.plannedCapacityHours)}
          </span>
          {day.bufferHours > 0 && (
            <span
              className="rounded bg-surface-hover px-1.5 py-0.5 text-[10px] font-medium text-chalk-dim"
              title="Kept free on purpose — the buffer % setting, not unplanned emptiness"
            >
              {formatHours(day.bufferHours)} buffer
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={onReprioritise}
            disabled={reprioritisePending}
            className="rounded border border-border px-2 py-1 text-[11px] text-chalk hover:bg-surface-hover disabled:opacity-50"
          >
            Re-prioritise
          </button>
          <button onClick={onAddBlock} className="rounded border border-border px-2 py-1 text-[11px] text-chalk hover:bg-surface-hover">
            + Block
          </button>
          <DayLockControl day={day} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-1.5 text-[11px] text-chalk-dim">
        <span>
          Start: <DayStartBadge day={day} />
        </span>
        <span>
          Lunch: <LunchOverrideBadge day={day} />
        </span>
      </div>

      {shoots.length > 0 && (
        <div className="space-y-1 border-b border-border px-3 py-1.5">
          {shoots.map((shoot) => (
            <div key={shoot.gid} className="truncate text-[10px] text-chalk">
              Shoot: {shoot.name}
              {(shoot.shootType || shoot.location) && <span className="text-chalk-dim"> ({[shoot.shootType, shoot.location].filter(Boolean).join(", ")})</span>}
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1.5 p-2.5">
        {sorted.length === 0 && <p className="py-3 text-center text-xs text-chalk-dim">Nothing scheduled.</p>}
        {sorted.map((row) =>
          row.kind === "event" ? (
            <EntryRow key={row.event.id} kind="event" event={row.event} />
          ) : row.kind === "lunch" ? (
            <EntryRow key="lunch" kind="lunch" startMinutes={row.startMinutes} endMinutes={row.endMinutes} />
          ) : (
            <EntryRow
              key={row.placement.id}
              kind="placement"
              task={row.task}
              placement={row.placement}
              onToggleDone={onToggleDone}
              onToggleMust={onToggleMust}
              onEdit={() => onEdit(row.task, row.placement)}
              onSplit={() => onSplit(row.task, row.placement)}
              onRemove={onRemove}
              onLock={onLock}
              onStart={onStart}
              checkoffReminderId={row.task.source === "asana" ? checkoffByReference.get(row.task.reference) : undefined}
              onDismissCheckoff={onDismissCheckoff}
            />
          )
        )}
      </div>
    </section>
  );
}
