"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ChatMarkdown } from "@/components/chat-markdown";
import {
  sendChatMessage,
  confirmPersonalTasks,
  confirmIdeas,
  confirmPriorityOverride,
  confirmPlanChange,
  confirmDistributeBlock,
  confirmMustChange,
  confirmRemoveBlock,
  confirmParkChange,
  confirmSetEstimate,
  confirmSplitBlock,
  appendAssistantMessage,
  clearChatHistory,
  type ChatProposal,
  type ChatProposalAction,
  type ChatHistoryEntry,
  type MondayListProposalItem,
} from "@/app/(app)/chat/actions";
import type { MatchCandidate } from "@/lib/chat/match";

type HistoryEntry = { kind: "user" | "answer" | "error"; text: string };
type MondayDraftItem = MondayListProposalItem & { linkedReference: string | null; include: boolean };
type PlanChangeDraft = { taskName: string; newDay: string; newDurationHours: string; candidates: MatchCandidate[]; selected: string | null };
type DistributeDraft = { taskName: string; distribution: { day: string; hours: number | null }[]; candidates: MatchCandidate[]; selected: string | null };
type EditDraft =
  | { kind: "must_change"; taskName: string; must: boolean; candidates: MatchCandidate[]; selected: string | null }
  | { kind: "remove_block"; taskName: string; candidates: MatchCandidate[]; selected: string | null }
  | { kind: "park_change"; taskName: string; parked: boolean; candidates: MatchCandidate[]; selected: string | null }
  | { kind: "set_estimate"; taskName: string; hours: number; candidates: MatchCandidate[]; selected: string | null }
  | { kind: "split_block"; taskName: string; hoursNow: number; remainder: "next-working-day" | "queue"; candidates: MatchCandidate[]; selected: string | null };

/** Same "parentName — name" convention the pickers below already render — a stage name like "Pre-Edit Review & Brief" is reused across every deliverable, so the bare name alone can't identify which one a confirmation message is about. */
function displayName(c: MatchCandidate): string {
  return c.parentName ? `${c.parentName} — ${c.name}` : c.name;
}

/**
 * Week-list rebuild: chat moves from a docked side panel to a bar fixed at
 * the bottom of the Week screen — one of the two ways to change anything now
 * that dragging is gone (the other is each entry's Edit button). Same
 * two-phase pattern underneath (classify, match in code, confirm) and the
 * exact same server actions as before; what changes here is presentation —
 * a continuous conversation thread you can go back and forth in, expanded
 * by default rather than a collapsible side widget.
 */
export function BottomChatBar({ initialHistory }: { initialHistory: ChatHistoryEntry[] }) {
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
  const [distributeDraft, setDistributeDraft] = useState<DistributeDraft | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [history, mondayDraft, ideaDraft, priorityDraft, planChangeDraft, distributeDraft, editDraft]);

  function applyAction(action: ChatProposalAction) {
    if (action.type === "monday_list") {
      setMondayDraft(
        action.items.map((item) => ({
          ...item,
          linkedReference: item.candidates[0]?.score && item.candidates[0].score >= 0.6 ? item.candidates[0].reference : null,
          include: true,
        }))
      );
    } else if (action.type === "idea") {
      setIdeaDraft(action.items.map((i) => i.title));
    } else if (action.type === "priority_override") {
      setPriorityDraft({
        taskName: action.taskName,
        newPriority: action.newPriority,
        candidates: action.candidates,
        selected: action.candidates[0] ? `${action.candidates[0].source}:${action.candidates[0].reference}` : null,
      });
    } else if (action.type === "plan_change") {
      setPlanChangeDraft({
        taskName: action.taskName,
        newDay: action.newDay ?? "",
        newDurationHours: action.newDurationHours != null ? String(action.newDurationHours) : "",
        candidates: action.candidates,
        selected: action.candidates[0] ? `${action.candidates[0].source}:${action.candidates[0].reference}` : null,
      });
    } else if (action.type === "distribute_block") {
      setDistributeDraft({
        taskName: action.taskName,
        distribution: action.distribution,
        candidates: action.candidates,
        selected: action.candidates[0] ? `${action.candidates[0].source}:${action.candidates[0].reference}` : null,
      });
    } else {
      const selected = action.candidates[0] ? `${action.candidates[0].source}:${action.candidates[0].reference}` : null;
      if (action.type === "must_change") setEditDraft({ kind: "must_change", taskName: action.taskName, must: action.must, candidates: action.candidates, selected });
      else if (action.type === "remove_block") setEditDraft({ kind: "remove_block", taskName: action.taskName, candidates: action.candidates, selected });
      else if (action.type === "park_change") setEditDraft({ kind: "park_change", taskName: action.taskName, parked: action.parked, candidates: action.candidates, selected });
      else if (action.type === "split_block")
        setEditDraft({ kind: "split_block", taskName: action.taskName, hoursNow: action.hoursNow, remainder: action.remainder, candidates: action.candidates, selected });
      else setEditDraft({ kind: "set_estimate", taskName: action.taskName, hours: action.hours, candidates: action.candidates, selected });
    }
  }

  function applyProposal(response: ChatProposal) {
    if (response.text) setHistory((h) => [...h, { kind: "answer", text: response.text }]);
    if (response.proposal) applyAction(response.proposal);
  }

  function send() {
    const text = input.trim();
    if (!text || pending) return;
    setInput("");
    // The model sees the conversation it's already having, not just this one
    // line — built from what's actually on screen, so it can never diverge
    // from what the user can see.
    const conversationHistory = history.filter((e) => e.kind !== "error").map((e) => ({ role: e.kind === "user" ? ("user" as const) : ("assistant" as const), content: e.text }));
    setHistory((h) => [...h, { kind: "user", text }]);
    startTransition(async () => {
      try {
        const response = await sendChatMessage(text, { editTools: true, history: conversationHistory });
        applyProposal(response);
      } catch (err) {
        setHistory((h) => [...h, { kind: "error", text: err instanceof Error ? err.message : "Something went wrong." }]);
      }
    });
  }

  function confirmMonday() {
    if (!mondayDraft) return;
    const items = mondayDraft.filter((i) => i.include);
    startTransition(async () => {
      const result = await confirmPersonalTasks(
        items.map((i) => ({ name: i.name, estimateHours: i.estimateHours, priority: i.priority, dueOn: i.dueOn, linkedReference: i.linkedReference })),
        true
      );
      setHistory((h) => [...h, { kind: result.unfitNames.length > 0 ? "error" : "answer", text: result.text }]);
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
    const selectedCandidate = priorityDraft.candidates.find((c) => `${c.source}:${c.reference}` === priorityDraft.selected);
    const name = selectedCandidate ? displayName(selectedCandidate) : priorityDraft.taskName;
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
    const selectedCandidate = planChangeDraft.candidates.find((c) => `${c.source}:${c.reference}` === planChangeDraft.selected);
    const name = selectedCandidate ? displayName(selectedCandidate) : planChangeDraft.taskName;
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

  function confirmDistribute() {
    if (!distributeDraft?.selected) return;
    const [source, reference] = distributeDraft.selected.split(":") as ["asana" | "personal", string];
    const selectedCandidate = distributeDraft.candidates.find((c) => `${c.source}:${c.reference}` === distributeDraft.selected);
    const name = selectedCandidate ? displayName(selectedCandidate) : distributeDraft.taskName;
    startTransition(async () => {
      try {
        const result = await confirmDistributeBlock(source, reference, name, distributeDraft.distribution);
        const text = `${name}: ${result.summaries.join(" ")}`;
        await appendAssistantMessage(text);
        setHistory((h) => [...h, { kind: "answer", text }]);
      } catch (err) {
        setHistory((h) => [...h, { kind: "error", text: err instanceof Error ? err.message : "Something went wrong." }]);
      }
      setDistributeDraft(null);
    });
  }

  function confirmEdit() {
    if (!editDraft?.selected) return;
    const [source, reference] = editDraft.selected.split(":") as ["asana" | "personal", string];
    const selectedCandidate = editDraft.candidates.find((c) => `${c.source}:${c.reference}` === editDraft.selected);
    const name = selectedCandidate ? displayName(selectedCandidate) : editDraft.taskName;
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
        } else if (editDraft.kind === "split_block") {
          const result = await confirmSplitBlock(source, reference, editDraft.hoursNow, editDraft.remainder);
          // Same redirect risk as a move — only claim "the rest to the next
          // working day" when resolveDrop actually managed to put it there.
          text = !result.landedAsRequested
            ? result.resolveDropSummary
            : `Split ${name} — ${editDraft.hoursNow}h now, the rest to ${editDraft.remainder === "queue" ? "the unscheduled queue" : "the next working day"}.`;
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

  const blocked =
    mondayDraft !== null || ideaDraft !== null || priorityDraft !== null || planChangeDraft !== null || distributeDraft !== null || editDraft !== null;

  if (collapsed) {
    return (
      <div className="flex w-10 flex-none flex-col items-center rounded-2xl border border-border bg-slate py-3">
        <button onClick={() => setCollapsed(false)} title="Expand chat" className="text-chalk-dim hover:text-chalk">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-7.5rem)] w-[340px] flex-none sticky top-20 flex-col rounded-2xl border border-border bg-slate">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-xs font-semibold text-chalk">Chat</span>
        <div className="flex items-center gap-3">
          {history.length > 0 && (
            <button onClick={clear} disabled={pending} className="text-xs text-chalk-dim hover:text-chalk">
              Clear
            </button>
          )}
          <button onClick={() => setCollapsed(true)} className="text-xs text-chalk-dim hover:text-chalk">
            Collapse
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto p-3">
        {history.length === 0 && !mondayDraft && !ideaDraft && !priorityDraft && !planChangeDraft && !distributeDraft && !editDraft && (
          <p className="text-xs text-chalk-dim">
            Tell me what&apos;s on this week — paste a list, ask what&apos;s at risk, or just talk it through: move things
            around, split a task, flag something Must, or say &quot;regenerate&quot; to rebuild the plan.
          </p>
        )}
        {history.map((entry, i) => (
          <div
            key={i}
            className={`max-w-[85%] rounded px-2 py-1.5 text-sm ${
              entry.kind === "user" ? "ml-auto bg-accent text-on-accent" : entry.kind === "error" ? "bg-danger-tint text-chalk" : "bg-raven text-chalk"
            }`}
          >
            <ChatMarkdown text={entry.text} />
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
                          Link to: {c.parentName ? `${c.parentName} — ${c.name}` : c.name}
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
                    {c.parentName ? `${c.parentName} — ${c.name}` : c.name}
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

        {distributeDraft && (
          <div className="space-y-2 rounded border border-info bg-info-tint p-2 text-xs text-chalk">
            <p className="font-medium text-chalk">Split across days:</p>
            {distributeDraft.candidates.length === 0 ? (
              <p className="text-chalk">No matching task found for &quot;{distributeDraft.taskName}&quot;.</p>
            ) : (
              <select
                value={distributeDraft.selected ?? ""}
                onChange={(e) => setDistributeDraft((d) => (d ? { ...d, selected: e.target.value || null } : d))}
                className="w-full rounded border border-border bg-slate px-1 py-0.5 text-chalk"
              >
                {distributeDraft.candidates.map((c) => (
                  <option key={`${c.source}:${c.reference}`} value={`${c.source}:${c.reference}`}>
                    {c.parentName ? `${c.parentName} — ${c.name}` : c.name}
                  </option>
                ))}
              </select>
            )}
            {distributeDraft.distribution.map((entry, i) => (
              <div key={i} className="flex items-center gap-1">
                <input
                  type="date"
                  value={entry.day}
                  onChange={(e) =>
                    setDistributeDraft((d) =>
                      d ? { ...d, distribution: d.distribution.map((row, j) => (j === i ? { ...row, day: e.target.value } : row)) } : d
                    )
                  }
                  className="flex-1 rounded border border-border bg-slate px-1 py-0.5 text-chalk"
                />
                <input
                  type="number"
                  step="0.25"
                  placeholder="even split"
                  value={entry.hours ?? ""}
                  onChange={(e) =>
                    setDistributeDraft((d) =>
                      d
                        ? {
                            ...d,
                            distribution: d.distribution.map((row, j) =>
                              j === i ? { ...row, hours: e.target.value === "" ? null : Number(e.target.value) } : row
                            ),
                          }
                        : d
                    )
                  }
                  className="w-24 rounded border border-border bg-slate px-1 py-0.5 text-chalk"
                />
              </div>
            ))}
            <p className="text-chalk-dim">
              {distributeDraft.distribution.some((r) => r.hours == null)
                ? "Blank fields split the remaining total evenly."
                : `Total: ${distributeDraft.distribution.reduce((sum, r) => sum + (r.hours ?? 0), 0)}h`}
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDistributeDraft(null)} className="text-chalk">
                Cancel
              </button>
              <button
                onClick={confirmDistribute}
                disabled={pending || !distributeDraft.selected}
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
                    : editDraft.kind === "split_block"
                      ? `Split ${editDraft.hoursNow}h now, rest to ${editDraft.remainder === "queue" ? "queue" : "next working day"}, for:`
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
          className="flex-1 rounded border border-border bg-raven px-2 py-1.5 text-sm text-chalk disabled:opacity-60"
        />
        <button type="submit" disabled={blocked || pending} className="rounded bg-accent px-3 py-1.5 text-sm text-on-accent disabled:opacity-50">
          Send
        </button>
      </form>
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
              {c.parentName ? `${c.parentName} — ${c.name}` : c.name}
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
