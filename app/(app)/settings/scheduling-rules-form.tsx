"use client";

import { useState, useTransition } from "react";
import { addSchedulingRule, removeSchedulingRule, setSchedulingRuleActive, type SchedulingRule } from "./rules-actions";
import { WEEKDAY_LABELS, type Weekday } from "@/lib/settings";

/**
 * Free-text standing rules that steer scheduling — e.g. "never schedule
 * edits on Fridays". Each is parsed once on add into a structured shape the
 * auto-placement engine can actually obey (lib/auto-placement.ts's
 * dayExcludedForCandidate); anything outside that shape is honestly labeled
 * "Chat-only" rather than silently claiming enforcement it doesn't have.
 */
export function SchedulingRulesForm({ initial }: { initial: SchedulingRule[] }) {
  const [rules, setRules] = useState(initial);
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function add() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setError(null);
    startTransition(async () => {
      try {
        await addSchedulingRule(trimmed);
        setText("");
        // The server action doesn't return the new row — simplest is to
        // just re-derive from `initial` on the next server render, but this
        // page doesn't auto-refetch client state, so show it immediately as
        // freeform (optimistic) and let the next page load correct the tag
        // once the model has actually classified it.
        setRules((r) => [
          ...r,
          { id: `pending-${Date.now()}`, text: trimmed, active: true, parsedKind: "freeform", parsedWeekday: null, parsedStage: null, conflict: null, blocksOnExcludedDay: null },
        ]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't add that rule.");
      }
    });
  }

  function remove(id: string) {
    setRules((r) => r.filter((x) => x.id !== id));
    startTransition(() => removeSchedulingRule(id));
  }

  function toggleActive(id: string, active: boolean) {
    setRules((r) => r.map((x) => (x.id === id ? { ...x, active } : x)));
    startTransition(() => setSchedulingRuleActive(id, active));
  }

  return (
    <section className="rounded-2xl border border-border bg-slate p-5">
      <h2 className="text-sm font-bold text-chalk">Rules &amp; context</h2>
      <p className="mt-1 text-xs text-chalk-dim">
        Standing rules the scheduler follows every week. A rule naming a weekday (optionally one kind of work) is enforced directly by
        Auto-Schedule/Regenerate; anything else is chat-only — the assistant knows it and can flag a conflict, but it won&apos;t change
        what gets auto-placed. Switch a rule off without deleting it, or add one straight from chat.
      </p>

      {error && <p className="mt-2 rounded border border-danger bg-danger-tint px-2 py-1 text-xs text-chalk">{error}</p>}

      <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-raven">
        {rules.length === 0 && <li className="px-3 py-3 text-xs text-chalk-dim">No rules yet.</li>}
        {rules.map((rule) => (
          <li key={rule.id} className="flex flex-col gap-1.5 px-3 py-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <label className="flex min-w-0 items-center gap-2">
                <input
                  type="checkbox"
                  checked={rule.active}
                  disabled={pending}
                  onChange={(e) => toggleActive(rule.id, e.target.checked)}
                  className="h-3.5 w-3.5 shrink-0"
                />
                <span className={rule.active ? "truncate text-chalk" : "truncate text-chalk-dim line-through"}>{rule.text}</span>
              </label>
              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                    !rule.active ? "bg-surface-hover text-chalk-dim" : rule.parsedKind === "avoid_weekday" ? "bg-success-tint text-success" : "bg-surface-hover text-chalk-dim"
                  }`}
                >
                  {!rule.active
                    ? "Off"
                    : rule.parsedKind === "avoid_weekday"
                      ? `Enforced: no${rule.parsedStage ? ` ${rule.parsedStage}` : ""} on ${WEEKDAY_LABELS[rule.parsedWeekday as Weekday]}`
                      : "Chat-only"}
                </span>
                <button disabled={pending} onClick={() => remove(rule.id)} className="text-xs text-chalk-dim underline hover:text-danger">
                  Remove
                </button>
              </div>
            </div>
            {rule.conflict && <p className="pl-5 text-[11px] font-medium text-danger">⚠ {rule.conflict}</p>}
            {rule.blocksOnExcludedDay != null && rule.blocksOnExcludedDay > 0 && (
              <p className="pl-5 text-[11px] text-chalk-dim">
                {rule.blocksOnExcludedDay} block{rule.blocksOnExcludedDay === 1 ? "" : "s"} already on that day this week (pinned/protected, so exempt)
              </p>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-2 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
          placeholder="e.g. never schedule edits on Fridays"
          className="flex-1 rounded border border-border bg-raven px-2 py-1 text-sm text-chalk"
        />
        <button onClick={add} disabled={pending || !text.trim()} className="rounded bg-accent px-3 py-1 text-xs font-medium text-on-accent disabled:opacity-50">
          Add
        </button>
      </div>
    </section>
  );
}
