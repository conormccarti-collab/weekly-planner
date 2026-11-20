"use client";

import { useState, useTransition } from "react";
import { saveProjectNotes } from "@/app/(app)/projects/actions";

export function ProjectNotes({ projectName, initialNotes }: { projectName: string; initialNotes: string }) {
  const [notes, setNotes] = useState(initialNotes);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(true);

  return (
    <div>
      <textarea
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
          setSaved(false);
        }}
        rows={6}
        placeholder="Free-text notes for this project…"
        className="w-full rounded border border-border bg-slate px-2 py-1.5 text-sm text-chalk"
      />
      <div className="mt-1 flex items-center gap-2">
        <button
          onClick={() =>
            startTransition(async () => {
              await saveProjectNotes(projectName, notes);
              setSaved(true);
            })
          }
          disabled={pending || saved}
          className="rounded bg-accent px-2 py-1 text-xs font-medium text-on-accent disabled:opacity-50"
        >
          Save notes
        </button>
        {saved && <span className="text-xs text-chalk-dim">Saved</span>}
      </div>
    </div>
  );
}
