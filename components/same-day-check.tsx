"use client";

import { useState, useTransition } from "react";
import { submitSameDayCheck } from "@/app/(app)/summary/actions";
import { formatHHMM } from "@/lib/time";
import type { EndedNotDoneBlock } from "@/lib/summary";
import type { MorningCheckOutcome } from "@/lib/morning-check";
import { WriteBackCompleteReview, type CompleteProposal } from "@/components/write-back-review";

/**
 * v3 (plan-first) stage 4 / v4 Stage 2, brief 5.7: "X was planned for 10:00
 * to 12:00: done, behind or moved?" with one-tap answers — the same-day
 * counterpart to tomorrow's morning check, shown directly under At risk.
 * "Moved" is its own outcome — it clears the placement and lets the block
 * fall out through the normal re-plan/"things changed" path, rather than
 * being folded into "on track".
 */
export function SameDayCheckList({ blocks }: { blocks: EndedNotDoneBlock[] }) {
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [completeProposals, setCompleteProposals] = useState<CompleteProposal[]>([]);
  const [pending, startTransition] = useTransition();

  function answer(block: EndedNotDoneBlock, outcome: MorningCheckOutcome) {
    setError(null);
    startTransition(async () => {
      try {
        await submitSameDayCheck(block.blockId, block.source, block.reference, outcome, block.plannedHours, null);
        setResolvedIds((prev) => new Set(prev).add(block.blockId));
        // Brief section 13 (Stage 10): same write-back proposal as the
        // morning check, for the same-day "done" case.
        if (outcome === "done" && block.source === "asana") {
          setCompleteProposals((p) => [...p, { gid: block.reference, name: block.name }]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });
  }

  const pendingBlocks = blocks.filter((b) => !resolvedIds.has(b.blockId));
  if (pendingBlocks.length === 0) return <WriteBackCompleteReview proposals={completeProposals} />;

  return (
    <>
      <WriteBackCompleteReview proposals={completeProposals} />
      <ul className="mt-2 space-y-2 text-xs">
      {pendingBlocks.map((block) => (
        <li key={block.blockId} className="rounded bg-slate p-2">
          <p className="text-chalk">
            {block.name} was planned for {formatHHMM(block.startMinutes)} to {formatHHMM(block.endMinutes)}: done, behind or moved?
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <button
              onClick={() => answer(block, "done")}
              disabled={pending}
              className="rounded border border-border px-2 py-0.5 text-chalk hover:bg-surface-hover disabled:opacity-50"
            >
              Done
            </button>
            <button
              onClick={() => answer(block, "behind")}
              disabled={pending}
              className="rounded border border-border px-2 py-0.5 text-chalk hover:bg-surface-hover disabled:opacity-50"
            >
              Behind
            </button>
            <button
              onClick={() => answer(block, "moved")}
              disabled={pending}
              className="rounded border border-border px-2 py-0.5 text-chalk hover:bg-surface-hover disabled:opacity-50"
            >
              Moved
            </button>
          </div>
        </li>
      ))}
      {error && <li className="text-danger">{error}</li>}
      </ul>
    </>
  );
}
