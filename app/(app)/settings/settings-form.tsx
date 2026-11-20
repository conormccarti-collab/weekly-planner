"use client";

import { useActionState, useState } from "react";
import { saveSettings } from "./actions";
import { WEEKDAYS, WEEKDAY_LABELS, type Settings } from "@/lib/settings";
import { OFFICES } from "@/lib/brand-colors";

type FormState = { ok: boolean; error?: string } | null;

async function submit(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    await saveSettings(formData);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Save failed" };
  }
}

export function SettingsForm({ initial }: { initial: Settings }) {
  const [state, formAction, pending] = useActionState(submit, null);
  const [workingDays, setWorkingDays] = useState<Set<string>>(new Set(initial.working_days));

  return (
    // React resets a form's uncontrolled fields to their defaultValue after
    // a Server Action submits. Keying on `initial` forces a remount with
    // the freshly-saved values once revalidation brings them back, instead
    // of silently snapping every field back to what it was before the save.
    <form key={JSON.stringify(initial)} action={formAction} className="max-w-xl space-y-6">
      <section>
        <h2 className="text-sm font-semibold text-chalk">Working days, start &amp; lunch times</h2>
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-3 text-xs font-medium text-chalk-dim">
            <span className="w-7" />
            <span className="w-28">Day</span>
            <span className="w-[108px]">Start time</span>
            <span className="w-[108px]">Lunch time</span>
          </div>
          {WEEKDAYS.map((day) => (
            <div key={day} className="flex items-center gap-3">
              <input
                type="checkbox"
                id={`working_day_${day}`}
                name={`working_day_${day}`}
                defaultChecked={workingDays.has(day)}
                onChange={(e) => {
                  const next = new Set(workingDays);
                  if (e.target.checked) {
                    next.add(day);
                  } else {
                    next.delete(day);
                  }
                  setWorkingDays(next);
                }}
                className="h-4 w-4"
              />
              <label htmlFor={`working_day_${day}`} className="w-28 text-sm text-chalk">
                {WEEKDAY_LABELS[day]}
              </label>
              <input
                type="time"
                name={`start_time_${day}`}
                defaultValue={initial.start_times[day] ?? ""}
                disabled={!workingDays.has(day)}
                className="w-[108px] rounded border border-border bg-slate px-2 py-1 text-sm text-chalk disabled:bg-surface-hover"
              />
              <input
                type="time"
                name={`lunch_time_${day}`}
                defaultValue={initial.lunch_times[day] ?? ""}
                disabled={!workingDays.has(day)}
                className="w-[108px] rounded border border-border bg-slate px-2 py-1 text-sm text-chalk disabled:bg-surface-hover"
              />
            </div>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-4">
        <Field label="Hours per working day">
          <input
            type="number"
            step="0.5"
            name="hours_per_day"
            defaultValue={initial.hours_per_day}
            className="w-full rounded border border-border bg-slate px-2 py-1 text-sm text-chalk"
          />
        </Field>
        <Field label="Planning percentage">
          <input
            type="number"
            name="planning_percentage"
            defaultValue={initial.planning_percentage}
            className="w-full rounded border border-border bg-slate px-2 py-1 text-sm text-chalk"
          />
        </Field>
        <Field label="Lunch length (minutes)">
          <input
            type="number"
            name="lunch_minutes"
            defaultValue={initial.lunch_minutes}
            className="w-full rounded border border-border bg-slate px-2 py-1 text-sm text-chalk"
          />
        </Field>
        <Field label="Minimum deep-work block (minutes)">
          <input
            type="number"
            name="min_deep_work_block_minutes"
            defaultValue={initial.min_deep_work_block_minutes}
            className="w-full rounded border border-border bg-slate px-2 py-1 text-sm text-chalk"
          />
        </Field>
        <Field label="Time zone">
          <input
            type="text"
            name="timezone"
            defaultValue={initial.timezone}
            className="w-full rounded border border-border bg-slate px-2 py-1 text-sm text-chalk"
          />
        </Field>
        <Field label="Office">
          <select
            name="office"
            defaultValue={initial.office ?? ""}
            className="w-full rounded border border-border bg-slate px-2 py-1 text-sm text-chalk"
          >
            <option value="">Default</option>
            {OFFICES.map((office) => (
              <option key={office} value={office}>
                {office}
              </option>
            ))}
          </select>
        </Field>
      </section>
      <p className="-mt-4 text-xs text-chalk-dim">Sets the app&apos;s accent colour only — it never changes per-task Brand colours on the calendar.</p>

      <section>
        <label className="flex items-center gap-2 text-sm text-chalk">
          <input type="checkbox" name="notifications_enabled" defaultChecked={initial.notifications_enabled} className="h-4 w-4" />
          Email me a morning summary on working days
        </label>
        <p className="mt-1 text-xs text-chalk-dim">
          Covers the morning check if it&apos;s still outstanding, deadline risks, and Hygiene flags on this week&apos;s
          deliverables. Sent only when there&apos;s something to report.
        </p>
      </section>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save settings"}
        </button>
        {state?.ok && <span className="text-sm text-success">Saved.</span>}
        {state?.error && <span className="text-sm text-danger">{state.error}</span>}
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-chalk-dim">{label}</span>
      {children}
    </label>
  );
}
