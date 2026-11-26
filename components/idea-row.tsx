"use client";

import { useState, useTransition } from "react";
import { convertIdeaToTask, dropIdea } from "@/app/(app)/ideas/actions";

export type IdeaRowData = { id: string; title: string; status: string; createdAt: string };

export function IdeaRow({ idea }: { idea: IdeaRowData }) {
  const [pending, startTransition] = useTransition();
  const [converting, setConverting] = useState(false);
  const [name, setName] = useState(idea.title);
  const [estimateHours, setEstimateHours] = useState("");
  const [priority, setPriority] = useState("");
  const [dueOn, setDueOn] = useState("");

  if (idea.status !== "open") {
    return (
      <li className="flex items-center justify-between px-5 py-2.5 text-sm text-chalk-dim">
        <span>
          {idea.title} <span className="text-xs">({idea.status})</span>
        </span>
        <span className="text-xs">{idea.createdAt}</span>
      </li>
    );
  }

  if (converting) {
    return (
      <li className="space-y-1 rounded border border-info bg-info-tint p-2 text-sm text-chalk mx-2 my-1">
        <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded border border-border bg-slate px-1 py-0.5 text-chalk" />
        <div className="flex flex-wrap gap-1">
          <input
            type="number"
            step="0.25"
            placeholder="hours"
            value={estimateHours}
            onChange={(e) => setEstimateHours(e.target.value)}
            className="w-20 rounded border border-border bg-slate px-1 py-0.5 text-xs text-chalk"
          />
          <input
            placeholder="priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="w-24 rounded border border-border bg-slate px-1 py-0.5 text-xs text-chalk"
          />
          <input
            type="date"
            value={dueOn}
            onChange={(e) => setDueOn(e.target.value)}
            className="rounded border border-border bg-slate px-1 py-0.5 text-xs text-chalk"
          />
        </div>
        <div className="flex justify-end gap-2 text-xs">
          <button onClick={() => setConverting(false)} className="text-chalk">
            Cancel
          </button>
          <button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await convertIdeaToTask(idea.id, name, estimateHours === "" ? null : Number(estimateHours), priority || null, dueOn || null);
              })
            }
            className="rounded bg-accent px-2 py-1 text-on-accent"
          >
            Create task
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm hover:bg-surface-hover">
      <div>
        <span className="font-bold text-chalk">{idea.title}</span>
        <div className="text-xs text-chalk-dim">Captured {idea.createdAt}</div>
      </div>
      <div className="flex flex-none items-center gap-2 text-xs">
        <button onClick={() => setConverting(true)} className="rounded-lg bg-accent px-3 py-1.5 font-bold text-on-accent">
          Make a task
        </button>
        <button
          disabled={pending}
          onClick={() => startTransition(() => dropIdea(idea.id))}
          className="rounded-lg border border-border px-3 py-1.5 font-bold text-chalk hover:border-danger hover:text-danger"
        >
          Drop
        </button>
      </div>
    </li>
  );
}
