"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import {
  sendChatMessage,
  confirmPersonalTasks,
  confirmIdeas,
  confirmPriorityOverride,
  confirmPlanChange,
  type ChatProposal,
  type MondayListProposalItem,
} from "@/app/(app)/chat/actions";
import type { MatchCandidate } from "@/lib/chat/match";
import { subscribeOpenChatPanel } from "@/lib/chat/open-chat-event";

type HistoryEntry =
  | { kind: "user"; text: string }
  | { kind: "answer"; text: string }
  | { kind: "error"; text: string };

type MondayDraftItem = MondayListProposalItem & { linkedReference: string | null; include: boolean };
type PriorityDraft = { taskName: string; newPriority: string; candidates: MatchCandidate[]; selected: string | null };
type PlanChangeDraft = { taskName: string; newDay: string; candidates: MatchCandidate[]; selected: string | null };

export function ChatButton() {
  // v4 Stage 2, brief 5.2: "Docked chat on the Week screen... It stays a
  // pop-up on other screens" — the Week screen renders its own docked
  // WeekChatPanel instead, so this floating button steps aside there to
  // avoid two chat entry points on the same screen.
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [input, setInput] = useState("");
  const [pending, startTransition] = useTransition();
  const [mondayDraft, setMondayDraft] = useState<MondayDraftItem[] | null>(null);
  const [ideaDraft, setIdeaDraft] = useState<string[] | null>(null);
  const [priorityDraft, setPriorityDraft] = useState<PriorityDraft | null>(null);
  const [planChangeDraft, setPlanChangeDraft] = useState<PlanChangeDraft | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => subscribeOpenChatPanel(() => setOpen(true)), []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [history, mondayDraft, ideaDraft, priorityDraft, planChangeDraft]);

  if (pathname === "/") return null;

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
        candidates: proposal.candidates,
        selected: proposal.candidates[0] ? `${proposal.candidates[0].source}:${proposal.candidates[0].reference}` : null,
      });
    } else if (proposal.type === "answer") {
      setHistory((h) => [...h, { kind: "answer", text: proposal.text }]);
    } else {
      // v4 Stage 2's edit tools (Must/remove/park/estimate) and "regenerate"
      // are only ever offered to the docked week-chat (sendChatMessage's
      // editTools option, never set to true from this floating popup), so
      // this is defensive, not an expected path.
      setHistory((h) => [...h, { kind: "error", text: "That kind of change isn't available from this chat — try it from the Week screen." }]);
    }
  }

  function send() {
    const text = input.trim();
    if (!text || pending) return;
    setInput("");
    setHistory((h) => [...h, { kind: "user", text }]);
    startTransition(async () => {
      try {
        const proposal = await sendChatMessage(text);
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
        items.map((i) => ({
          name: i.name,
          estimateHours: i.estimateHours,
          priority: i.priority,
          dueOn: i.dueOn,
          linkedReference: i.linkedReference,
        }))
      );
      const created = items.filter((i) => !i.linkedReference).length;
      const linked = items.length - created;
      setHistory((h) => [
        ...h,
        { kind: "answer", text: `Added ${created} task${created === 1 ? "" : "s"}${linked > 0 ? `, linked ${linked} to existing tasks` : ""}.` },
      ]);
      setMondayDraft(null);
    });
  }

  function confirmIdea() {
    if (!ideaDraft) return;
    startTransition(async () => {
      await confirmIdeas(ideaDraft.map((title) => ({ title })));
      setHistory((h) => [...h, { kind: "answer", text: `Added ${ideaDraft.length} idea${ideaDraft.length === 1 ? "" : "s"}.` }]);
      setIdeaDraft(null);
    });
  }

  function confirmPriority() {
    if (!priorityDraft?.selected) return;
    const [source, reference] = priorityDraft.selected.split(":") as ["asana" | "personal", string];
    startTransition(async () => {
      try {
        await confirmPriorityOverride(source, reference, priorityDraft.newPriority);
        setHistory((h) => [...h, { kind: "answer", text: `Set priority to ${priorityDraft.newPriority}.` }]);
      } catch (err) {
        setHistory((h) => [...h, { kind: "error", text: err instanceof Error ? err.message : "Something went wrong." }]);
      }
      setPriorityDraft(null);
    });
  }

  function confirmMove() {
    if (!planChangeDraft?.selected || !planChangeDraft.newDay) return;
    const [source, reference] = planChangeDraft.selected.split(":") as ["asana" | "personal", string];
    startTransition(async () => {
      try {
        await confirmPlanChange(source, reference, planChangeDraft.newDay);
        setHistory((h) => [...h, { kind: "answer", text: `Moved to ${planChangeDraft.newDay}.` }]);
      } catch (err) {
        setHistory((h) => [...h, { kind: "error", text: err instanceof Error ? err.message : "Something went wrong." }]);
      }
      setPlanChangeDraft(null);
    });
  }

  const blocked = mondayDraft !== null || ideaDraft !== null || priorityDraft !== null || planChangeDraft !== null;

  return (
    <>
      {open && (
        <div className="fixed bottom-20 right-6 flex max-h-[70vh] w-96 flex-col rounded-lg border border-border bg-slate shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-sm font-semibold text-chalk">Chat</span>
            <button onClick={() => setOpen(false)} className="text-chalk-dim hover:text-chalk">
              ×
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto p-3">
            {history.length === 0 && !mondayDraft && !ideaDraft && !priorityDraft && !planChangeDraft && (
              <p className="text-xs text-chalk-dim">
                Paste your Monday list, write &quot;Idea: ...&quot;, ask a question about your week, or ask to move a
                task or change its priority.
              </p>
            )}
            {history.map((entry, i) => (
              <div
                key={i}
                className={`rounded px-2 py-1.5 text-sm ${
                  entry.kind === "user"
                    ? "ml-6 bg-accent text-on-accent"
                    : entry.kind === "error"
                      ? "bg-danger-tint text-chalk"
                      : "bg-raven text-chalk"
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
                        onChange={(e) =>
                          setMondayDraft((d) => d!.map((x, j) => (j === i ? { ...x, include: e.target.checked } : x)))
                        }
                      />
                      <input
                        value={item.name}
                        onChange={(e) =>
                          setMondayDraft((d) => d!.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                        }
                        className="flex-1 rounded border border-border bg-slate px-1 py-0.5 text-chalk"
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-1 pl-5">
                      <input
                        type="number"
                        step="0.25"
                        placeholder="hours"
                        value={item.estimateHours ?? ""}
                        onChange={(e) =>
                          setMondayDraft((d) =>
                            d!.map((x, j) => (j === i ? { ...x, estimateHours: e.target.value === "" ? null : Number(e.target.value) } : x))
                          )
                        }
                        className="w-16 rounded border border-border bg-slate px-1 py-0.5 text-chalk"
                      />
                      <input
                        placeholder="priority"
                        value={item.priority ?? ""}
                        onChange={(e) =>
                          setMondayDraft((d) => d!.map((x, j) => (j === i ? { ...x, priority: e.target.value || null } : x)))
                        }
                        className="w-20 rounded border border-border bg-slate px-1 py-0.5 text-chalk"
                      />
                      <input
                        type="date"
                        value={item.dueOn ?? ""}
                        onChange={(e) =>
                          setMondayDraft((d) => d!.map((x, j) => (j === i ? { ...x, dueOn: e.target.value || null } : x)))
                        }
                        className="rounded border border-border bg-slate px-1 py-0.5 text-chalk"
                      />
                    </div>
                    {item.candidates.length > 0 && (
                      <div className="pl-5">
                        <select
                          value={item.linkedReference ?? ""}
                          onChange={(e) =>
                            setMondayDraft((d) =>
                              d!.map((x, j) => (j === i ? { ...x, linkedReference: e.target.value || null } : x))
                            )
                          }
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
              <div className="space-y-2 rounded border border-info bg-info-tint p-2 text-xs text-chalk">
                <p className="font-medium text-chalk">
                  Set priority to &quot;{priorityDraft.newPriority}&quot; for:
                </p>
                {priorityDraft.candidates.length === 0 ? (
                  <p className="text-chalk">No matching task found for &quot;{priorityDraft.taskName}&quot;.</p>
                ) : (
                  <select
                    value={priorityDraft.selected ?? ""}
                    onChange={(e) => setPriorityDraft((d) => (d ? { ...d, selected: e.target.value || null } : d))}
                    className="w-full rounded border border-border bg-slate px-1 py-0.5 text-chalk"
                  >
                    {priorityDraft.candidates.map((c) => (
                      <option key={`${c.source}:${c.reference}`} value={`${c.source}:${c.reference}`}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                )}
                <div className="flex justify-end gap-2">
                  <button onClick={() => setPriorityDraft(null)} className="text-chalk">
                    Cancel
                  </button>
                  <button
                    onClick={confirmPriority}
                    disabled={pending || !priorityDraft.selected}
                    className="rounded bg-accent px-2 py-1 text-on-accent disabled:opacity-50"
                  >
                    Confirm
                  </button>
                </div>
              </div>
            )}

            {planChangeDraft && (
              <div className="space-y-2 rounded border border-info bg-info-tint p-2 text-xs text-chalk">
                <p className="font-medium text-chalk">Move to a new day:</p>
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
                <input
                  type="date"
                  value={planChangeDraft.newDay}
                  onChange={(e) => setPlanChangeDraft((d) => (d ? { ...d, newDay: e.target.value } : d))}
                  className="w-full rounded border border-border bg-slate px-1 py-0.5 text-chalk"
                />
                <div className="flex justify-end gap-2">
                  <button onClick={() => setPlanChangeDraft(null)} className="text-chalk">
                    Cancel
                  </button>
                  <button
                    onClick={confirmMove}
                    disabled={pending || !planChangeDraft.selected || !planChangeDraft.newDay}
                    className="rounded bg-accent px-2 py-1 text-on-accent disabled:opacity-50"
                  >
                    Confirm
                  </button>
                </div>
              </div>
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
            <button
              type="submit"
              disabled={blocked || pending}
              className="rounded bg-accent px-2 py-1 text-sm text-on-accent disabled:opacity-50"
            >
              Send
            </button>
          </form>
        </div>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-6 right-6 rounded-full bg-accent px-4 py-3 text-sm font-medium text-on-accent shadow-lg hover:opacity-90"
      >
        Chat
      </button>
    </>
  );
}
