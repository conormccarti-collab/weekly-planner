"use client";

import { useState, useTransition } from "react";
import { approveCompleteTask, approveDueDateChange, restoreDueDate } from "@/app/(app)/write-back/actions";

export type CompleteProposal = { gid: string; name: string };
export type DueDateProposal = { gid: string; name: string; oldDueOn: string; newDay: string };

/**
 * Brief section 13 (Stage 10): "Every write starts as a proposal showing
 * what will change and the current value, with Approve and Reject. One
 * task at a time. No bulk approval." Reject just moves on — nothing is
 * written. Shared by the morning check and the same-day check, the two
 * places a "done" outcome on an Asana task can surface this.
 */
export function WriteBackCompleteReview({ proposals }: { proposals: CompleteProposal[] }) {
  const [remaining, setRemaining] = useState(proposals);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (remaining.length === 0) return null;
  const current = remaining[0];

  function advance() {
    setRemaining((r) => r.slice(1));
    setError(null);
  }

  return (
    <div className="mb-4 rounded border border-info bg-info-tint p-3 text-sm text-chalk">
      <p>
        Mark <span className="font-medium">{current.name}</span> complete in Asana too?
      </p>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      <div className="mt-2 flex justify-end gap-2">
        <button onClick={advance} disabled={pending} className="text-xs text-chalk">
          Reject
        </button>
        <button
          onClick={() =>
            startTransition(async () => {
              try {
                await approveCompleteTask(current.gid);
                advance();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Something went wrong.");
              }
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

/**
 * Brief section 13: "moving a block past its due date proposes a new due
 * date... Offer 'Restore previous value' for a date change." Approve
 * applies it; once applied, a Restore button re-applies the old value
 * (itself a new approved write, logged the same way) instead of silently
 * undoing anything.
 */
export function WriteBackDueDateReview({ proposal, onDone }: { proposal: DueDateProposal | null; onDone: () => void }) {
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!proposal) return null;

  if (applied) {
    return (
      <div className="mb-4 rounded border border-info bg-info-tint p-3 text-sm text-chalk">
        <p>
          Due date for <span className="font-medium">{proposal.name}</span> changed to {proposal.newDay} in Asana.
        </p>
        {error && <p className="mt-1 text-xs text-danger">{error}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <button onClick={onDone} className="text-xs text-chalk">
            Close
          </button>
          <button
            onClick={() =>
              startTransition(async () => {
                try {
                  await restoreDueDate(proposal.gid, proposal.oldDueOn);
                  onDone();
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Something went wrong.");
                }
              })
            }
            disabled={pending}
            className="rounded border border-border px-3 py-1 text-xs font-medium text-chalk hover:bg-surface-hover disabled:opacity-50"
          >
            Restore previous value ({proposal.oldDueOn})
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-4 rounded border border-info bg-info-tint p-3 text-sm text-chalk">
      <p>
        <span className="font-medium">{proposal.name}</span> was moved past its due date ({proposal.oldDueOn}). Change the due date in
        Asana to {proposal.newDay}?
      </p>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      <div className="mt-2 flex justify-end gap-2">
        <button onClick={onDone} disabled={pending} className="text-xs text-chalk">
          Reject
        </button>
        <button
          onClick={() =>
            startTransition(async () => {
              try {
                await approveDueDateChange(proposal.gid, proposal.oldDueOn, proposal.newDay);
                setApplied(true);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Something went wrong.");
              }
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
