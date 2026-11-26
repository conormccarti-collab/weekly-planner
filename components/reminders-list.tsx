"use client";

import { useState, useTransition } from "react";
import { addPlannedProject, dismissReminder } from "@/app/(app)/reminders/actions";
import type { RemindersData } from "@/lib/reminders";

/**
 * Follow-up reminders: a subtask you don't own, due soon, on a task that is
 * yours. There's no placed block to attach this to (the subtask isn't
 * assigned to you, so it's never scheduled), so it stays its own section.
 * The "check it off in Asana" reminder instead shows inline on the task's
 * own row once it's marked done (components/week/entry-row.tsx).
 *
 * New-project reminders: a task from a project never seen before showed up
 * outside the planned-projects workflow (lib/asana/eligibility.ts) — a
 * one-time nudge so it doesn't sit unnoticed in "Outside the workflow" on
 * the Projects page, with an explicit choice either way.
 */
export function RemindersList({ data }: { data: RemindersData }) {
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [addedGids, setAddedGids] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const newProjects = data.newProjects.filter((p) => !dismissedIds.has(p.id) && !addedGids.has(p.projectGid));

  if (data.followUps.length === 0 && newProjects.length === 0) return null;

  function dismiss(id: string) {
    setDismissedIds((prev) => new Set(prev).add(id));
    startTransition(async () => {
      await dismissReminder(id);
    });
  }

  function addProject(gid: string) {
    setAddedGids((prev) => new Set(prev).add(gid));
    startTransition(async () => {
      await addPlannedProject(gid);
    });
  }

  return (
    <div className="mb-4 rounded border border-info bg-info-tint p-3 text-sm text-chalk">
      {newProjects.length > 0 && (
        <div className="mb-2">
          <p className="font-medium text-chalk">New project noticed</p>
          <ul className="mt-1 space-y-1.5 text-xs">
            {newProjects.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2">
                <span>
                  {p.projectName} <span className="text-chalk-dim">— not currently planned, counted, or flagged</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <button
                    onClick={() => addProject(p.projectGid)}
                    disabled={pending}
                    className="rounded bg-accent px-2 py-0.5 text-[11px] font-medium text-on-accent disabled:opacity-50"
                  >
                    Add to planned projects
                  </button>
                  <button onClick={() => dismiss(p.id)} disabled={pending} className="text-chalk-dim underline disabled:opacity-50">
                    Dismiss
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.followUps.length > 0 && (
        <div>
          <p className="font-medium text-chalk">Follow up</p>
          <ul className="mt-1 space-y-1 text-xs">
            {data.followUps.map((f) => (
              <li key={f.subtaskGid}>
                {f.containerName} — {f.subtaskName}
                {f.assigneeName && <>, assigned to {f.assigneeName}</>}, due {f.dueOn}
                {f.isOverdue && <span className="ml-1 font-medium text-danger">(overdue)</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
