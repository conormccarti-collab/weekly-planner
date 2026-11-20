"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  sendChatMessage,
  confirmPersonalTasks,
  confirmIdeas,
  confirmPriorityOverride,
  confirmPlanChange,
  confirmMustChange,
  confirmRemoveBlock,
  confirmParkChange,
  confirmSetEstimate,
  appendAssistantMessage,
  clearChatHistory,
  type ChatProposal,
  type ChatHistoryEntry,
  type MondayListProposalItem,
} from "@/app/(app)/chat/actions";
import type { MatchCandidate } from "@/lib/chat/match";

type HistoryEntry = { kind: "user" | "answer" | "error"; text: string };
type MondayDraftItem = MondayListProposalItem & { linkedReference: string | null; include: boolean };
type PlanChangeDraft = { taskName: string; newDay: string; newDurationHours: string; candidates: MatchCandidate[]; selected: string | null };
/** v4 Stage 2, brief 5.3: the four new edit tools share the same shape — a task name to resolve, candidates to pick from, and one typed payload. */
type EditDraft =
  | { kind: "must_change"; taskName: string; must: boolean; candidates: MatchCandidate[]; selected: string | null }
  | { kind: "remove_block"; taskName: string; candidates: MatchCandidate[]; selected: string | null }
  | { kind: "park_change"; taskName: string; parked: boolean; candidates: MatchCandidate[]; selected: string | null }
  | { kind: "set_estimate"; taskName: string; hours: number; candidates: MatchCandidate[]; selected: string | null };

/**
 * v4 Stage 2, brief sections 5.2-5.5: docked on the Week screen, open by
 * default, persisted for the current week (reset on Accept or Clear), and
 * able to edit the draft directly — a plan edit confirms inline on an
 * unambiguous match (handled server-side in `sendChatMessage`); this panel
 * only needs a picker for the genuinely ambiguous cases, plus the review
 * cards Monday-list/ideas have always needed.
 */
export function WeekChatPanel({ initialHistory }: { initialHistory: ChatHistoryEntry[] }) {
  const [collapsed, setCollapsed] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>(
    initialHistory.map((m) => ({ kind: m.role === "user" ? "user" : "answer", text: m.content }))
  );
  const [input, setInput] = useState("");
  const [pending, startTransition] = useTransition();
  const [mondayDraft, setMondayDraft] = useState<MondayDraftItem[] | null>(null);
  const [ideaDraft, setIdeaDraft] = useState<string[] | null>(null);
  const [priorityDraft, setPriorityDraft] = useState<{ taskName: string; newPriority: string; candidates: MatchCandidate[]; selected: string | null } | null>(null);
  const [planChangeDraft, setPlanChangeDraft] = useState<PlanChangeDraft | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [history, mondayDraft, ideaDraft, priorityDraft, planChangeDraft, editDraft]);

  function applyProposal(proposal: ChatProposal) {
    if (proposal.type === "monday_list") {
      setMondayDraft(
        proposal.items.map((item) => ({
          ...item,
          linkedReference: item.candidates[0]?.score && item.candidates[0].score >= 0.6 ? item.candidates[0].reference : null,
          include: true,
        }))
      );
    } else if (proposal.type === "idea") {
      setIdeaDraft(proposal.items.map((i) => i.title));
    } else if (proposal.type === "priority_override") {
      setPriorityDraft({
        taskName: proposal.taskName,
        newPriority: proposal.newPriority,
        candidates: proposal.candidates,
        selected: proposal.candidates[0] ? `${proposal.candidates[0].source}:${proposal.candidates[0].reference}` : null,
      });
    } else if (proposal.type === "plan_change") {
      setPlanChangeDraft({
        taskName: proposal.taskName,
        newDay: proposal.newDay ?? "",
        newDurationHours: proposal.newDurationHours != null ? String(proposal.newDurationHours) : "",
        candidates: proposal.candidates,
        selected: proposal.candidates[0] ? `${proposal.candidates[0].source}:${proposal.candidates[0].reference}` : null,
      });
    } else if (proposal.type === "answer") {
      setHistory((h) => [...h, { kind: "answer", text: proposal.text }]);
    } else if (proposal.type === "regenerated") {
      setHistory((h) => [...h, { kind: "answer", text: "Regenerated the unpinned part of the draft." }]);
    } else {
      const selected = proposal.candidates[0] ? `${proposal.candidates[0].source}:${proposal.candidates[0].reference}` : null;
      if (proposal.type === "must_change") setEditDraft({ kind: "must_change", taskName: proposal.taskName, must: proposal.must, candidates: proposal.candidates, selected });
      else if (proposal.type === "remove_block") setEditDraft({ kind: "remove_block", taskName: proposal.taskName, candidates: proposal.candidates, selected });
      else if (proposal.type === "park_change") setEditDraft({ kind: "park_change", taskName: proposal.taskName, parked: proposal.parked, candidates: proposal.candidates, selected });
      else setEditDraft({ kind: "set_estimate", taskName: proposal.taskName, hours: proposal.hours, candidates: proposal.candidates, selected });
    }
  }

  function send() {
    const text = input.trim();
    if (!text || pending) return;
    setInput("");
    setHistory((h) => [...h, { kind: "user", text }]);
    startTransition(async () => {
      try {
        const proposal = await sendChatMessage(text, { editTools: true });
        applyProposal(proposal);
      } catch (err) {
        setHistory((h) => [...h, { kind: "error", text: err instanceof Error ? err.message : "Something went wrong." }]);
      }
    });
  }

  function confirmMonday() {
    if (!mondayDraft) return;
    const items = mondayDraft.filter((i) => i.include);
    startTransition(async () => {
      await confirmPersonalTasks(
        items.map((i) => ({ name: i.name, estimateHours: i.estimateHours, priority: i.priority, dueOn: i.dueOn, linkedReference: i.linkedReference })),
        true
      );
      const created = items.filter((i) => !i.linkedReference).length;
      const linked = items.length - created;
      setHistory((h) => [...h, { kind: "answer", text: `Added ${created} task${created === 1 ? "" : "s"}${linked > 0 ? `, linked ${linked} to existing tasks` : ""}.` }]);
      setMondayDraft(null);
    });
  }

  function confirmIdea() {
    if (!ideaDraft) return;
    startTransition(async () => {
      await confirmIdeas(ideaDraft.map((title) => ({ title })), true);
      setHistory((h) => [...h, { kind: "answer", text: `Added ${ideaDraft.length} idea${ideaDraft.length === 1 ? "" : "s"}.` }]);
      setIdeaDraft(null);
    });
  }

  function confirmPriority() {
    if (!priorityDraft?.selected) return;
    const [source, reference] = priorityDraft.selected.split(":") as ["asana" | "personal", string];
    const name = priorityDraft.candidates.find((c) => `${c.source}:${c.reference}` === priorityDraft.selected)?.name ?? priorityDraft.taskName;
    startTransition(async () => {
      const text = `Set priority to ${priorityDraft.newPriority} for ${name}.`;
      try {
        await confirmPriorityOverride(source, reference, priorityDraft.newPriority);
        await appendAssistantMessage(text);
        setHistory((h) => [...h, { kind: "answer", text }]);
      } catch (err) {
        setHistory((h) => [...h, { kind: "error", text: err instanceof Error ? err.message : "Something went wrong." }]);
      }
      setPriorityDraft(null);
    });
  }

  function confirmMove() {
    if (!planChangeDraft?.selected) return;
    const [source, reference] = planChangeDraft.selected.split(":") as ["asana" | "personal", string];
    const name = planChangeDraft.candidates.find((c) => `${c.source}:${c.reference}` === planChangeDraft.selected)?.name ?? planChangeDraft.taskName;
    const hours = planChangeDraft.newDurationHours === "" ? null : Number(planChangeDraft.newDurationHours);
    startTransition(async () => {
      const text = `Moved ${name}${planChangeDraft.newDay ? ` to ${planChangeDraft.newDay}` : ""}${hours ? ` (${hours}h)` : ""}.`;
      try {
        await confirmPlanChange(source, reference, planChangeDraft.newDay || null, hours);
        await appendAssistantMessage(text);
        setHistory((h) => [...h, { kind: "answer", text }]);
      } catch (err) {
        setHistory((h) => [...h, { kind: "error", text: err instanceof Error ? err.message : "Something went wrong." }]);
      }
      setPlanChangeDraft(null);
    });
  }

  function confirmEdit() {
    if (!editDraft?.selected) return;
    const [source, reference] = editDraft.selected.split(":") as ["asana" | "personal", string];
    const name = editDraft.candidates.find((c) => `${c.source}:${c.reference}` === editDraft.selected)?.name ?? editDraft.taskName;
    startTransition(async () => {
      let text: string;
      try {
        if (editDraft.kind === "must_change") {
          await confirmMustChange(source, reference, editDraft.must);
          text = `${editDraft.must ? "Flagged" : "Cleared Must on"} ${name}${editDraft.must ? " as Must" : ""}.`;
        } else if (editDraft.kind === "remove_block") {
          await confirmRemoveBlock(source, reference);
          text = `Took ${name} off the calendar.`;
        } else if (editDraft.kind === "park_change") {
          await confirmParkChange(source, reference, editDraft.parked);
          text = `${editDraft.parked ? "Parked" : "Unparked"} ${name}.`;
        } else {
          await confirmSetEstimate(source, reference, editDraft.hours);
          text = `Set ${name} to ${editDraft.hours}h.`;
        }
        await appendAssistantMessage(text);
        setHistory((h) => [...h, { kind: "answer", text }]);
      } catch (err) {
        setHistory((h) => [...h, { kind: "error", text: err instanceof Error ? err.message : "Something went wrong." }]);
      }
      setEditDraft(null);
    });
  }

  function clear() {
    startTransition(async () => {
      await clearChatHistory();
      setHistory([]);
    });
  }

  const blocked = mondayDraft !== null || ideaDraft !== null || priorityDraft !== null || planChangeDraft !== null || editDraft !== null;

  return (
    <div className="mb-4 flex max-h-[32rem] flex-col rounded-lg border border-border bg-slate">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-sm font-semibold text-chalk">Chat</span>
        <div className="flex items-center gap-3">
          {history.length > 0 && !collapsed && (
            <button onClick={clear} disabled={pending} className="text-xs text-chalk-dim hover:text-chalk">
              Clear
            </button>
          )}
          <button onClick={() => setCollapsed((v) => !v)} className="text-xs text-chalk-dim hover:text-chalk">
            {collapsed ? "Expand" : "Collapse"}
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto p-3">
            {history.length === 0 && !mondayDraft && !ideaDraft && !priorityDraft && !planChangeDraft && !editDraft && (
              <p className="text-xs text-chalk-dim">
                Paste your Monday list, write &quot;Idea: ...&quot;, ask what&apos;s at risk, or tell it to move, resize,
                remove, park, estimate or flag Must on a task — or type &quot;regenerate&quot; to rebuild the unpinned
                part of the draft.
              </p>
            )}
            {history.map((entry, i) => (
              <div
                key={i}
                className={`rounded px-2 py-1.5 text-sm ${
                  entry.kind === "user" ? "ml-6 bg-accent text-on-accent" : entry.kind === "error" ? "bg-danger-tint text-chalk" : "bg-raven text-chalk"
                }`}
              >
                {entry.text}
              </div>
            ))}

            {mondayDraft && (
              <div className="space-y-2 rounded border border-info bg-info-tint p-2">
                <p className="text-xs font-medium text-chalk">Review before adding to your tasks:</p>
                {mondayDraft.map((item, i) => (
                  <div key={i} className="space-y-1 rounded bg-raven p-2 text-xs">
                    <div className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={item.include}
                        onChange={(e) => setMondayDraft((d) => d!.map((x, j) => (j === i ? { ...x, include: e.target.checked } : x)))}
                      />
                      <input
                        value={item.name}
                        onChange={(e) => setMondayDraft((d) => d!.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                        className="flex-1 rounded border border-border bg-slate px-1 py-0.5 text-chalk"
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-1 pl-5">
                      <input
                        type="number"
                        step="0.25"
                        placeholder="hours"
                        value={item.estimateHours ?? ""}
                        onChange={(e) => setMondayDraft((d) => d!.map((x, j) => (j === i ? { ...x, estimateHours: e.target.value === "" ? null : Number(e.target.value) } : x)))}
                        className="w-16 rounded border border-border bg-slate px-1 py-0.5 text-chalk"
                      />
                      <input
                        placeholder="priority"
                        value={item.priority ?? ""}
                        onChange={(e) => setMondayDraft((d) => d!.map((x, j) => (j === i ? { ...x, priority: e.target.value || null } : x)))}
                        className="w-20 rounded border border-border bg-slate px-1 py-0.5 text-chalk"
                      />
                      <input
                        type="date"
                        value={item.dueOn ?? ""}
                        onChange={(e) => setMondayDraft((d) => d!.map((x, j) => (j === i ? { ...x, dueOn: e.target.value || null } : x)))}
                        className="rounded border border-border bg-slate px-1 py-0.5 text-chalk"
                      />
                    </div>
                    {item.candidates.length > 0 && (
                      <div className="pl-5">
                        <select
                          value={item.linkedReference ?? ""}
                          onChange={(e) => setMondayDraft((d) => d!.map((x, j) => (j === i ? { ...x, linkedReference: e.target.value || null } : x)))}
                          className="w-full rounded border border-border bg-slate px-1 py-0.5 text-chalk"
                        >
                          <option value="">Create as new task</option>
                          {item.candidates.map((c) => (
                            <option key={c.reference} value={c.reference}>
                              Link to: {c.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                ))}
                <div className="flex justify-end gap-2">
                  <button onClick={() => setMondayDraft(null)} className="text-chalk">
                    Cancel
                  </button>
                  <button onClick={confirmMonday} disabled={pending} className="rounded bg-accent px-2 py-1 text-on-accent">
                    Confirm
                  </button>
                </div>
              </div>
            )}

            {ideaDraft && (
              <div className="space-y-2 rounded border border-info bg-info-tint p-2">
                <p className="text-xs font-medium text-chalk">Add to ideas:</p>
                {ideaDraft.map((title, i) => (
                  <input
                    key={i}
                    value={title}
                    onChange={(e) => setIdeaDraft((d) => d!.map((x, j) => (j === i ? e.target.value : x)))}
                    className="w-full rounded border border-border bg-slate px-1 py-0.5 text-xs text-chalk"
                  />
                ))}
                <div className="flex justify-end gap-2">
                  <button onClick={() => setIdeaDraft(null)} className="text-chalk">
                    Cancel
                  </button>
                  <button onClick={confirmIdea} disabled={pending} className="rounded bg-accent px-2 py-1 text-on-accent">
                    Confirm
                  </button>
                </div>
              </div>
            )}

            {priorityDraft && (
              <PickerCard
                prompt={`Set priority to "${priorityDraft.newPriority}" for:`}
                taskName={priorityDraft.taskName}
                candidates={priorityDraft.candidates}
                selected={priorityDraft.selected}
                onSelect={(v) => setPriorityDraft((d) => (d ? { ...d, selected: v } : d))}
                onCancel={() => setPriorityDraft(null)}
                onConfirm={confirmPriority}
                pending={pending}
              />
            )}

            {planChangeDraft && (
              <div className="space-y-2 rounded border border-info bg-info-tint p-2 text-xs text-chalk">
                <p className="font-medium text-chalk">Move and/or resize:</p>
                {planChangeDraft.candidates.length === 0 ? (
                  <p className="text-chalk">No matching task found for &quot;{planChangeDraft.taskName}&quot;.</p>
                ) : (
                  <select
                    value={planChangeDraft.selected ?? ""}
                    onChange={(e) => setPlanChangeDraft((d) => (d ? { ...d, selected: e.target.value || null } : d))}
                    className="w-full rounded border border-border bg-slate px-1 py-0.5 text-chalk"
                  >
                    {planChangeDraft.candidates.map((c) => (
                      <option key={`${c.source}:${c.reference}`} value={`${c.source}:${c.reference}`}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                )}
                <div className="flex items-center gap-1">
                  <input
                    type="date"
                    value={planChangeDraft.newDay}
                    onChange={(e) => setPlanChangeDraft((d) => (d ? { ...d, newDay: e.target.value } : d))}
                    className="flex-1 rounded border border-border bg-slate px-1 py-0.5 text-chalk"
                  />
                  <input
                    type="number"
                    step="0.25"
                    placeholder="hours"
                    value={planChangeDraft.newDurationHours}
                    onChange={(e) => setPlanChangeDraft((d) => (d ? { ...d, newDurationHours: e.target.value } : d))}
                    className="w-20 rounded border border-border bg-slate px-1 py-0.5 text-chalk"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setPlanChangeDraft(null)} className="text-chalk">
                    Cancel
                  </button>
                  <button
                    onClick={confirmMove}
                    disabled={pending || !planChangeDraft.selected}
                    className="rounded bg-accent px-2 py-1 text-on-accent disabled:opacity-50"
                  >
                    Confirm
                  </button>
                </div>
              </div>
            )}

            {editDraft && (
              <PickerCard
                prompt={
                  editDraft.kind === "must_change"
                    ? `${editDraft.must ? "Flag" : "Clear Must on"}:`
                    : editDraft.kind === "remove_block"
                      ? "Take off the calendar:"
                      : editDraft.kind === "park_change"
                        ? `${editDraft.parked ? "Park" : "Unpark"}:`
                        : `Set estimate to ${editDraft.hours}h for:`
                }
                taskName={editDraft.taskName}
                candidates={editDraft.candidates}
                selected={editDraft.selected}
                onSelect={(v) => setEditDraft((d) => (d ? { ...d, selected: v } : d))}
                onCancel={() => setEditDraft(null)}
                onConfirm={confirmEdit}
                pending={pending}
              />
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
            className="flex items-center gap-1 border-t border-border p-2"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={blocked || pending}
              placeholder={blocked ? "Resolve the review above first" : "Type a message…"}
              className="flex-1 rounded border border-border bg-slate px-2 py-1 text-sm text-chalk disabled:bg-surface-hover"
            />
            <button type="submit" disabled={blocked || pending} className="rounded bg-accent px-2 py-1 text-sm text-on-accent disabled:opacity-50">
              Send
            </button>
          </form>
        </>
      )}
    </div>
  );
}

function PickerCard({
  prompt,
  taskName,
  candidates,
  selected,
  onSelect,
  onCancel,
  onConfirm,
  pending,
}: {
  prompt: string;
  taskName: string;
  candidates: MatchCandidate[];
  selected: string | null;
  onSelect: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <div className="space-y-2 rounded border border-info bg-info-tint p-2 text-xs text-chalk">
      <p className="font-medium text-chalk">{prompt}</p>
      {candidates.length === 0 ? (
        <p className="text-chalk">No matching task found for &quot;{taskName}&quot;.</p>
      ) : (
        <select value={selected ?? ""} onChange={(e) => onSelect(e.target.value)} className="w-full rounded border border-border bg-slate px-1 py-0.5 text-chalk">
          {candidates.map((c) => (
            <option key={`${c.source}:${c.reference}`} value={`${c.source}:${c.reference}`}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="text-chalk">
          Cancel
        </button>
        <button onClick={onConfirm} disabled={pending || !selected} className="rounded bg-accent px-2 py-1 text-on-accent disabled:opacity-50">
          Confirm
        </button>
      </div>
    </div>
  );
}
