"use client";

import { useState, useTransition } from "react";
import { addPlannedProject, dismissReminder } from "@/app/(app)/reminders/actions";
import { setTaskEstimate, setParked } from "@/app/(app)/tasks/actions";
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
 *
 * Unconfirmed-estimate reminders: a guessed estimate (tier 4, "suggested")
 * still backing something actually on the board a couple of days later —
 * the exact failure mode that let one bad guess (2.5h for what was really
 * a 14h task) silently cap real placement until the real number finally
 * surfaced days later. Resolved the moment it's confirmed or corrected
 * (setTaskEstimate always writes estimate_origin: "user"), no separate
 * dismissal needed.
 *
 * Stale-filler reminders: something currently occupying real calendar
 * space with no due date, or one weeks out — "if it's not due soon then
 * why is it even there?", the live question that uncovered tonight's
 * obstacle-predicate bug. Parking it (same action as the Projects page's
 * own Park control) removes it from planning entirely; "Leave it" just
 * hides this card's copy for now; both resolve once re-surfaced by the
 * next load (parked tasks stop being placed at all, so they stop
 * qualifying here on their own).
 */
export function RemindersList({ data }: { data: RemindersData }) {
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [addedGids, setAddedGids] = useState<Set<string>>(new Set());
  const [confirmedKeys, setConfirmedKeys] = useState<Set<string>>(new Set());
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editHours, setEditHours] = useState("");
  const [handledFillerKeys, setHandledFillerKeys] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const newProjects = data.newProjects.filter((p) => !dismissedIds.has(p.id) && !addedGids.has(p.projectGid));
  const unconfirmedEstimates = data.unconfirmedEstimates.filter((e) => !confirmedKeys.has(`${e.source}:${e.reference}`));
  const staleFiller = data.staleFiller.filter((s) => !handledFillerKeys.has(`${s.source}:${s.reference}`));

  if (data.followUps.length === 0 && newProjects.length === 0 && unconfirmedEstimates.length === 0 && staleFiller.length === 0) return null;

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

  function confirmEstimate(e: RemindersData["unconfirmedEstimates"][number], hours: number) {
    setConfirmedKeys((prev) => new Set(prev).add(`${e.source}:${e.reference}`));
    setEditingKey(null);
    startTransition(async () => {
      await setTaskEstimate(e.source, e.reference, hours, { stage: e.stage, focusType: e.focusType, videoType: e.videoType });
    });
  }

  function parkFiller(s: RemindersData["staleFiller"][number]) {
    setHandledFillerKeys((prev) => new Set(prev).add(`${s.source}:${s.reference}`));
    startTransition(async () => {
      await setParked(s.source, s.reference, true);
    });
  }

  function leaveFiller(s: RemindersData["staleFiller"][number]) {
    setHandledFillerKeys((prev) => new Set(prev).add(`${s.source}:${s.reference}`));
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
      {unconfirmedEstimates.length > 0 && (
        <div className="mt-2">
          <p className="font-medium text-chalk">Confirm these estimates</p>
          <ul className="mt-1 space-y-1.5 text-xs">
            {unconfirmedEstimates.map((e) => {
              const key = `${e.source}:${e.reference}`;
              return (
                <li key={key} className="flex items-center justify-between gap-2">
                  {editingKey === key ? (
                    <>
                      <span>{e.name}</span>
                      <span className="flex shrink-0 items-center gap-1">
                        <input
                          type="number"
                          step="0.25"
                          autoFocus
                          value={editHours}
                          onChange={(ev) => setEditHours(ev.target.value)}
                          className="w-16 rounded border border-border bg-raven px-1 py-0.5 text-chalk"
                        />
                        <button
                          onClick={() => confirmEstimate(e, Number(editHours))}
                          disabled={pending || editHours === ""}
                          className="rounded bg-accent px-2 py-0.5 text-[11px] font-medium text-on-accent disabled:opacity-50"
                        >
                          Save
                        </button>
                        <button onClick={() => setEditingKey(null)} className="text-chalk-dim underline">
                          Cancel
                        </button>
                      </span>
                    </>
                  ) : (
                    <>
                      <span>
                        {e.name} <span className="text-chalk-dim">— {e.hours != null ? `guessed at ${e.hours}h` : "no estimate yet"}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        {e.hours != null && (
                          <button
                            onClick={() => confirmEstimate(e, e.hours as number)}
                            disabled={pending}
                            className="rounded bg-accent px-2 py-0.5 text-[11px] font-medium text-on-accent disabled:opacity-50"
                          >
                            That&apos;s right
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setEditingKey(key);
                            setEditHours(e.hours != null ? String(e.hours) : "");
                          }}
                          disabled={pending}
                          className="text-chalk-dim underline disabled:opacity-50"
                        >
                          {e.hours != null ? "Correct it" : "Give an estimate"}
                        </button>
                      </span>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {staleFiller.length > 0 && (
        <div className="mt-2">
          <p className="font-medium text-chalk">Sitting with no real deadline</p>
          <ul className="mt-1 space-y-1.5 text-xs">
            {staleFiller.map((s) => {
              const key = `${s.source}:${s.reference}`;
              return (
                <li key={key} className="flex items-center justify-between gap-2">
                  <span>
                    {s.name} <span className="text-chalk-dim">— {s.dueOn ? `due ${s.dueOn}` : "no due date"}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => parkFiller(s)}
                      disabled={pending}
                      className="rounded bg-accent px-2 py-0.5 text-[11px] font-medium text-on-accent disabled:opacity-50"
                    >
                      Park it
                    </button>
                    <button onClick={() => leaveFiller(s)} disabled={pending} className="text-chalk-dim underline disabled:opacity-50">
                      Leave it
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
