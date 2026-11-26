"use client";

import { useState, useTransition } from "react";
import { approveSuggestion, rejectSuggestion } from "@/app/(app)/suggestions/actions";
import type { LearnedSuggestion } from "@/lib/plan-pattern-learning";

/**
 * v5 Stage 18c: a learned scheduling pattern (lib/plan-pattern-learning.ts,
 * detected daily by the cron, never on a page read). Approve creates a
 * real standing rule (Settings → Rules & context); reject self-silences
 * this exact pattern for 30 days rather than deleting it outright.
 */
export function SuggestionsList({ data }: { data: LearnedSuggestion[] }) {
  const [handledIds, setHandledIds] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const visible = data.filter((s) => !handledIds.has(s.id));
  if (visible.length === 0) return null;

  function approve(s: LearnedSuggestion) {
    setHandledIds((prev) => new Set(prev).add(s.id));
    startTransition(() => approveSuggestion(s.id, s.ruleText));
  }

  function reject(id: string) {
    setHandledIds((prev) => new Set(prev).add(id));
    startTransition(() => rejectSuggestion(id));
  }

  return (
    <div className="mb-4 rounded border border-info bg-info-tint p-3 text-sm text-chalk">
      <p className="font-medium text-chalk">Noticed a pattern</p>
      <ul className="mt-1 space-y-1.5 text-xs">
        {visible.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-2">
            <span>{s.ruleText}</span>
            <span className="flex shrink-0 items-center gap-2">
              <button
                onClick={() => approve(s)}
                disabled={pending}
                className="rounded bg-accent px-2 py-0.5 text-[11px] font-medium text-on-accent disabled:opacity-50"
              >
                Add as rule
              </button>
              <button onClick={() => reject(s.id)} disabled={pending} className="text-chalk-dim underline disabled:opacity-50">
                Not now
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
