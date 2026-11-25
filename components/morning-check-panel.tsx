"use client";

import { useState, useTransition } from "react";
import { submitMorningCheck, type MorningCheckData, type MorningCheckSubmission } from "@/app/(app)/morning-check/actions";
import type { MorningCheckOutcome } from "@/lib/morning-check";

type DraftItem = MorningCheckData["items"][number] & { outcome: MorningCheckOutcome; hoursLeft: string };

/**
 * v3 (plan-first) stage 6, brief 9.3: "the morning check... do[es] not need
 * a separate button" — `initial` is computed server-side on every page
 * load (same as the draft-week refresh), and this renders immediately
 * when there's anything to review, with no trigger step.
 */
export function MorningCheckPanel({ initial }: { initial: MorningCheckData }) {
  const [data, setData] = useState<MorningCheckData | null>(
    initial.items.length > 0 || initial.checkedDays.length > 0 ? initial : null
  );
  const [drafts, setDrafts] = useState<DraftItem[] | null>(
    data ? data.items.map((item) => ({ ...item, outcome: "on_track", hoursLeft: "" })) : null
  );
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!data || !drafts) return;
    const outcomes: MorningCheckSubmission[] = drafts.map((d) => ({
      blockId: d.blockId,
      source: d.source,
      reference: d.reference,
      outcome: d.outcome,
      plannedHours: d.plannedHours,
      hoursLeft: d.hoursLeft === "" ? null : Number(d.hoursLeft),
    }));
    startTransition(async () => {
      try {
        await submitMorningCheck(data.checkedDays, outcomes);
        setMessage(
          `Checked ${data.checkedDays.length} day${data.checkedDays.length === 1 ? "" : "s"}${
            data.autoClosedCount > 0 ? ` (${data.autoClosedCount} closed automatically from Asana)` : ""
          }.`
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
      setData(null);
      setDrafts(null);
    });
  }

  if (!data || !drafts) {
    return message || error ? (
      <div className="mb-4">
        {message && <p className="text-xs text-success">{message}</p>}
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    ) : null;
  }

  return (
    <div className="mb-4">
      <div className="rounded-2xl border border-info bg-info-tint p-3 text-sm text-chalk shadow-sm">
          {data.autoClosedCount > 0 && (
            <p className="mb-2 text-xs text-chalk">
              {data.autoClosedCount} task{data.autoClosedCount === 1 ? "" : "s"} already completed in Asana — closed automatically.
            </p>
          )}
          {drafts.length === 0 ? (
            <p className="text-chalk">
              {data.checkedDays.length === 0
                ? "Nothing to check — every prior desk day this week is already reviewed or had no capacity."
                : `Nothing else to check for ${data.checkedDays.join(", ")}.`}
            </p>
          ) : (
            <>
              <p className="font-medium text-chalk">
                For each task planned on {data.checkedDays.join(", ")}:
              </p>
              <ul className="mt-2 space-y-2 text-xs">
                {drafts.map((item, i) => (
                  <li key={item.blockId} className="rounded bg-slate p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span>
                        {item.parentName ? `${item.parentName} — ${item.name}` : item.name}{" "}
                        <span className="text-chalk-dim">({item.day}, {item.plannedHours}h planned)</span>
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {(["done", "on_track", "behind", "moved"] as MorningCheckOutcome[]).map((outcome) => (
                        <label key={outcome} className="flex items-center gap-1">
                          <input
                            type="radio"
                            name={`outcome-${item.blockId}`}
                            checked={item.outcome === outcome}
                            onChange={() => setDrafts((d) => d!.map((x, j) => (j === i ? { ...x, outcome } : x)))}
                          />
                          {outcome === "done" ? "Done" : outcome === "on_track" ? "On track" : outcome === "behind" ? "Behind" : "Moved"}
                        </label>
                      ))}
                      {item.outcome === "behind" && (
                        <input
                          type="number"
                          step="0.25"
                          min="0"
                          placeholder="hours left"
                          value={item.hoursLeft}
                          onChange={(e) => setDrafts((d) => d!.map((x, j) => (j === i ? { ...x, hoursLeft: e.target.value } : x)))}
                          className="w-20 rounded border border-border bg-slate px-1 py-0.5 text-chalk"
                        />
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <button
              onClick={() => {
                setData(null);
                setDrafts(null);
              }}
              disabled={pending}
              className="text-xs text-chalk"
            >
              {data.checkedDays.length === 0 ? "Close" : "Cancel"}
            </button>
            {data.checkedDays.length > 0 && (
              <button onClick={submit} disabled={pending} className="rounded bg-accent px-3 py-1 text-xs font-medium text-on-accent disabled:opacity-50">
                Submit
              </button>
            )}
          </div>
      </div>
    </div>
  );
}
