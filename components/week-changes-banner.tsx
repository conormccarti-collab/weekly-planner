"use client";

import { useState, useTransition } from "react";
import { applyWeekChanges, type WeekChanges } from "@/app/(app)/plan/changes-actions";
import { WEEKDAY_LABELS } from "@/lib/settings";
import { formatHHMM, weekdayOfDateStr } from "@/lib/time";

/**
 * v3 (plan-first), brief 3.4: "Things have changed. Review a new
 * proposal?" Shown only once a week is accepted and something newly
 * eligible has no row in the plan yet — every already-accepted block is
 * left exactly as it is.
 */
export function WeekChangesBanner({ initial }: { initial: WeekChanges }) {
  const [changes, setChanges] = useState<WeekChanges | null>(initial);
  const [reviewing, setReviewing] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!changes) return null;

  if (!reviewing) {
    return (
      <div className="mb-4 flex items-center justify-between rounded border border-info bg-info-tint px-3 py-2 text-sm text-chalk">
        <span>Things have changed. Review a new proposal?</span>
        <button onClick={() => setReviewing(true)} className="rounded bg-accent px-3 py-1 text-xs font-medium text-on-accent hover:opacity-90">
          Review
        </button>
      </div>
    );
  }

  return (
    <div className="mb-4 rounded border border-info bg-info-tint p-3 text-sm text-chalk">
      <p className="font-medium text-chalk">New since you accepted this week:</p>
      {changes.newItems.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs">
          {changes.newItems.map((item, i) => (
            <li key={i} className="flex items-center justify-between gap-2">
              <span>
                {item.name}
                {item.isSuggested && <span className="ml-1 text-chalk">(suggested)</span>}
              </span>
              <span className="text-chalk">
                {WEEKDAY_LABELS[weekdayOfDateStr(item.day)]} {formatHHMM(item.startMinutes)}–{formatHHMM(item.endMinutes)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {changes.needsEstimate.length > 0 && (
        <p className="mt-2 text-xs text-chalk">
          {changes.needsEstimate.length} new task{changes.needsEstimate.length === 1 ? "" : "s"} couldn&apos;t be placed this week (no room, or needs an
          estimate pick) — added to Unplaced instead.
        </p>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <button onClick={() => setReviewing(false)} disabled={pending} className="text-xs text-chalk">
          Reject
        </button>
        <button
          onClick={() =>
            startTransition(async () => {
              await applyWeekChanges(changes.weekStart, changes.newItems, changes.needsEstimate);
              setChanges(null);
            })
          }
          disabled={pending}
          className="rounded bg-accent px-3 py-1 text-xs font-medium text-on-accent disabled:opacity-50"
        >
          Approve
        </button>
      </div>
    </div>
  );
}
