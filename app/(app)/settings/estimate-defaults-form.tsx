"use client";

import { useState, useTransition } from "react";
import { updateEstimateDefault } from "./actions";
import type { EstimateDefaultRow } from "@/lib/estimates-data";

/** v4 Stage 1, brief section 5: "Editable estimate defaults in Settings, with changes written to estimate_history." */
export function EstimateDefaultsForm({ initial }: { initial: EstimateDefaultRow[] }) {
  const [rows, setRows] = useState(initial);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function keyOf(row: EstimateDefaultRow): string {
    return `${row.video_type}:${row.stage}:${row.variant}`;
  }

  function save(row: EstimateDefaultRow, hours: number) {
    const key = keyOf(row);
    setSavingKey(key);
    setSavedKey(null);
    setError(null);
    startTransition(async () => {
      try {
        await updateEstimateDefault(row.video_type, row.stage, row.variant, hours);
        setRows((prev) => prev.map((r) => (keyOf(r) === key ? { ...r, hours } : r)));
        setSavedKey(key);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Save failed");
      }
      setSavingKey(null);
    });
  }

  return (
    <section className="rounded-2xl border border-border bg-slate p-5">
      <h2 className="text-sm font-bold text-chalk">Estimate defaults</h2>
      <p className="mt-1 text-xs text-chalk-dim">
        Default hours used when a task has no estimate of its own and none learned from past entries. Every change is logged.
      </p>
      <div className="mt-3 space-y-1">
        <div className="flex items-center gap-2 text-xs font-medium text-chalk-dim">
          <span className="w-36">Video type</span>
          <span className="w-44">Stage</span>
          <span className="w-24">Variant</span>
          <span className="w-20">Hours</span>
          <span className="w-16" />
        </div>
        {rows.map((row) => {
          const key = keyOf(row);
          return (
            <DefaultRow key={key} row={row} saving={savingKey === key} saved={savedKey === key} onSave={(hours) => save(row, hours)} />
          );
        })}
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </section>
  );
}

function DefaultRow({
  row,
  saving,
  saved,
  onSave,
}: {
  row: EstimateDefaultRow;
  saving: boolean;
  saved: boolean;
  onSave: (hours: number) => void;
}) {
  const [hours, setHours] = useState(String(row.hours));
  const dirty = Number(hours) !== row.hours;

  return (
    <div className="flex items-center gap-2 text-sm text-chalk">
      <span className="w-36 truncate">{row.video_type}</span>
      <span className="w-44 truncate">{row.stage}</span>
      <span className="w-24 truncate text-chalk-dim">{row.variant || "—"}</span>
      <input
        type="number"
        step="0.5"
        min="0"
        value={hours}
        onChange={(e) => setHours(e.target.value)}
        className="w-20 rounded border border-border bg-slate px-2 py-1 text-sm text-chalk"
      />
      <div className="flex w-16 items-center gap-1">
        <button
          type="button"
          disabled={!dirty || saving || !Number.isFinite(Number(hours)) || Number(hours) < 0}
          onClick={() => onSave(Number(hours))}
          className="rounded border border-border px-2 py-1 text-xs font-medium text-chalk hover:bg-surface-hover disabled:opacity-50"
        >
          {saving ? "…" : "Save"}
        </button>
        {!dirty && saved && <span className="text-xs text-success">Saved</span>}
      </div>
    </div>
  );
}
