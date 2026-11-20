"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { classifyChatMessage } from "@/lib/chat/claude";
import { buildChatContext, loadExistingTaskNames } from "@/lib/chat/context";
import { findCandidateMatches, type MatchCandidate } from "@/lib/chat/match";
import { setPriorityOverride, setParked, setTaskEstimate } from "@/app/(app)/tasks/actions";
import { moveBlock, setPlanMust, removeBlock } from "@/app/(app)/plan/actions";
import { refreshDraftWeek } from "@/app/(app)/plan/build-actions";
import { addDaysToDateStr, mondayOf, parseHHMM, utcInstantToLocal } from "@/lib/time";
import { env } from "@/lib/env";

async function requireUser(supabase: SupabaseClient): Promise<User> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  return data.user;
}

function currentWeekStart(): string {
  return mondayOf(utcInstantToLocal(new Date(), env.appTimezone()).dateStr);
}

async function logChatTurn(
  persist: boolean,
  supabase: SupabaseClient,
  userId: string,
  weekStart: string,
  userText: string,
  assistantText: string
) {
  // v4 Stage 2, brief 5.4: only the docked week-chat's turns persist — the
  // floating popup used on every other screen stays in-memory only, as before.
  if (!persist) return;
  await supabase.from("chat_messages").insert([
    { user_id: userId, week_start: weekStart, role: "user", content: userText },
    { user_id: userId, week_start: weekStart, role: "assistant", content: assistantText },
  ]);
}

export type MondayListProposalItem = {
  name: string;
  estimateHours: number | null;
  priority: string | null;
  dueOn: string | null;
  candidates: MatchCandidate[];
};

export type ChatProposal =
  | { type: "monday_list"; items: MondayListProposalItem[] }
  | { type: "idea"; items: { title: string }[] }
  | { type: "answer"; text: string }
  | { type: "priority_override"; taskName: string; newPriority: string; candidates: MatchCandidate[] }
  | { type: "plan_change"; taskName: string; newDay: string | null; newDurationHours: number | null; candidates: MatchCandidate[] }
  | { type: "must_change"; taskName: string; must: boolean; candidates: MatchCandidate[] }
  | { type: "remove_block"; taskName: string; candidates: MatchCandidate[] }
  | { type: "park_change"; taskName: string; parked: boolean; candidates: MatchCandidate[] }
  | { type: "set_estimate"; taskName: string; hours: number; candidates: MatchCandidate[] }
  | { type: "regenerated" };

export type ChatHistoryEntry = { role: "user" | "assistant"; content: string };

export async function loadChatHistory(): Promise<ChatHistoryEntry[]> {
  const supabase = await createClient();
  const user = await requireUser(supabase);
  const { data } = await supabase
    .from("chat_messages")
    .select("role, content")
    .eq("user_id", user.id)
    .eq("week_start", currentWeekStart())
    .order("created_at", { ascending: true });
  return (data ?? []) as ChatHistoryEntry[];
}

/** v4 Stage 2, brief 5.4: "Reset it when the week is accepted or the user clears it." */
export async function clearChatHistory(): Promise<void> {
  const supabase = await createClient();
  const user = await requireUser(supabase);
  await supabase.from("chat_messages").delete().eq("user_id", user.id).eq("week_start", currentWeekStart());
}

/**
 * For a picker-based edit (ambiguous match, resolved by the user picking a
 * candidate and clicking Confirm) — the panel already knows the exact text
 * it showed for that outcome, so it logs it verbatim rather than this file
 * re-deriving the task name a second time.
 */
export async function appendAssistantMessage(text: string): Promise<void> {
  const supabase = await createClient();
  const user = await requireUser(supabase);
  await supabase.from("chat_messages").insert({ user_id: user.id, week_start: currentWeekStart(), role: "assistant", content: text });
}

/**
 * v4 Stage 2, brief 5.3: the docked week-chat can edit the draft directly.
 * A plan-editing tool (Must, move/resize, remove, park, estimate) executes
 * immediately when the name match is unambiguous — "simple moves confirm
 * inline instead of through a full review card" — and only falls back to a
 * picker when there's more than one candidate (or none). Monday-list/ideas
 * still always need an explicit review-and-confirm, since those create new
 * rows rather than editing an existing one.
 */
export async function sendChatMessage(message: string, options?: { editTools?: boolean }): Promise<ChatProposal> {
  const supabase = await createClient();
  const user = await requireUser(supabase);
  const weekStart = currentWeekStart();
  const persist = options?.editTools ?? false;

  // v4 Stage 2, brief 5.5: "a regenerate control" — also reachable by typing
  // it, handled before any model call so it can never be misclassified.
  // Only meaningful from the docked week-chat (editTools) — the floating
  // popup on other screens has no draft plan to regenerate.
  if (options?.editTools && message.trim().toLowerCase() === "regenerate") {
    await refreshDraftWeek(weekStart);
    await logChatTurn(persist, supabase, user.id, weekStart, message, "Regenerated the unpinned part of the draft.");
    return { type: "regenerated" };
  }

  const contextBlock = await buildChatContext(supabase, user.id);
  const classification = await classifyChatMessage(message, contextBlock, { includeEditTools: options?.editTools ?? false });

  if (classification.type === "monday_list") {
    const existingNames = await loadExistingTaskNames(supabase, user.id);
    const items: MondayListProposalItem[] = classification.items.map((item) => ({
      ...item,
      candidates: findCandidateMatches(item.name, existingNames),
    }));
    await logChatTurn(persist, supabase, user.id, weekStart, message, `Reviewing ${items.length} item${items.length === 1 ? "" : "s"} for your task list.`);
    return { type: "monday_list", items };
  }

  if (classification.type === "idea") {
    await logChatTurn(persist, supabase, user.id, weekStart, message, `Reviewing ${classification.items.length} idea${classification.items.length === 1 ? "" : "s"}.`);
    return { type: "idea", items: classification.items };
  }

  if (classification.type === "answer") {
    await logChatTurn(persist, supabase, user.id, weekStart, message, classification.answerText);
    return { type: "answer", text: classification.answerText };
  }

  if (classification.type === "priority_override") {
    const existingNames = await loadExistingTaskNames(supabase, user.id);
    const candidates = findCandidateMatches(classification.taskName, existingNames, { minScore: 0 });
    if (candidates.length === 1) {
      await setPriorityOverride(candidates[0].source, candidates[0].reference, classification.newPriority);
      const text = `Set priority to ${classification.newPriority} for ${candidates[0].name}.`;
      await logChatTurn(persist, supabase, user.id, weekStart, message, text);
      return { type: "answer", text };
    }
    await logChatTurn(persist, supabase, user.id, weekStart, message, `Which task should get priority ${classification.newPriority}?`);
    return { type: "priority_override", taskName: classification.taskName, newPriority: classification.newPriority, candidates };
  }

  if (classification.type === "plan_change") {
    const existingNames = await loadExistingTaskNames(supabase, user.id);
    const candidates = findCandidateMatches(classification.taskName, existingNames, { minScore: 0 });
    if (candidates.length === 1 && classification.newDay) {
      try {
        await confirmPlanChange(candidates[0].source, candidates[0].reference, classification.newDay, classification.newDurationHours);
        const text = `Moved ${candidates[0].name} to ${classification.newDay}${classification.newDurationHours ? ` (${classification.newDurationHours}h)` : ""}.`;
        await logChatTurn(persist, supabase, user.id, weekStart, message, text);
        return { type: "answer", text };
      } catch (err) {
        const text = err instanceof Error ? err.message : "Couldn't move that task.";
        await logChatTurn(persist, supabase, user.id, weekStart, message, text);
        return { type: "answer", text };
      }
    }
    await logChatTurn(persist, supabase, user.id, weekStart, message, `Which task do you mean?`);
    return {
      type: "plan_change",
      taskName: classification.taskName,
      newDay: classification.newDay,
      newDurationHours: classification.newDurationHours,
      candidates,
    };
  }

  if (classification.type === "must_change") {
    const existingNames = await loadExistingTaskNames(supabase, user.id);
    const candidates = findCandidateMatches(classification.taskName, existingNames, { minScore: 0 });
    if (candidates.length === 1) {
      await setPlanMust(weekStart, candidates[0].source, candidates[0].reference, classification.must);
      const text = `${classification.must ? "Flagged" : "Cleared Must on"} ${candidates[0].name}${classification.must ? " as Must" : ""}.`;
      await logChatTurn(persist, supabase, user.id, weekStart, message, text);
      return { type: "answer", text };
    }
    await logChatTurn(persist, supabase, user.id, weekStart, message, `Which task do you mean?`);
    return { type: "must_change", taskName: classification.taskName, must: classification.must, candidates };
  }

  if (classification.type === "remove_block") {
    const existingNames = await loadExistingTaskNames(supabase, user.id);
    const candidates = findCandidateMatches(classification.taskName, existingNames, { minScore: 0 });
    if (candidates.length === 1) {
      const text = await removeMatchedBlock(supabase, user.id, weekStart, candidates[0]);
      await logChatTurn(persist, supabase, user.id, weekStart, message, text);
      return { type: "answer", text };
    }
    await logChatTurn(persist, supabase, user.id, weekStart, message, `Which task do you mean?`);
    return { type: "remove_block", taskName: classification.taskName, candidates };
  }

  if (classification.type === "park_change") {
    const existingNames = await loadExistingTaskNames(supabase, user.id);
    const candidates = findCandidateMatches(classification.taskName, existingNames, { minScore: 0 });
    if (candidates.length === 1) {
      await setParked(candidates[0].source, candidates[0].reference, classification.parked);
      const text = `${classification.parked ? "Parked" : "Unparked"} ${candidates[0].name}.`;
      await logChatTurn(persist, supabase, user.id, weekStart, message, text);
      return { type: "answer", text };
    }
    await logChatTurn(persist, supabase, user.id, weekStart, message, `Which task do you mean?`);
    return { type: "park_change", taskName: classification.taskName, parked: classification.parked, candidates };
  }

  // classification.type === "set_estimate"
  const existingNames = await loadExistingTaskNames(supabase, user.id);
  const candidates = findCandidateMatches(classification.taskName, existingNames, { minScore: 0 });
  if (candidates.length === 1) {
    // No stage/focus/video-type context is cheaply available for an
    // arbitrary name match here, so the "learned" tier won't pick this up
    // for other tasks of the same type — only this exact task's own figure
    // (tier 1) is set, which is still the main thing being asked for.
    await setTaskEstimate(candidates[0].source, candidates[0].reference, classification.hours, { stage: null, focusType: null, videoType: null });
    const text = `Set ${candidates[0].name} to ${classification.hours}h.`;
    await logChatTurn(persist, supabase, user.id, weekStart, message, text);
    return { type: "answer", text };
  }
  await logChatTurn(persist, supabase, user.id, weekStart, message, `Which task do you mean?`);
  return { type: "set_estimate", taskName: classification.taskName, hours: classification.hours, candidates };
}

async function removeMatchedBlock(supabase: SupabaseClient, userId: string, weekStart: string, candidate: MatchCandidate): Promise<string> {
  const { data: rows } = await supabase
    .from("plan_items")
    .select("id, must")
    .eq("user_id", userId)
    .eq("source", candidate.source)
    .eq("reference", candidate.reference)
    .not("day", "is", null);
  const row = rows?.[0];
  if (!row) return `${candidate.name} isn't on the calendar.`;
  await removeBlock(weekStart, row.id, candidate.source, candidate.reference, row.must);
  return `Took ${candidate.name} off the calendar.`;
}

export type ConfirmedPersonalTask = {
  name: string;
  estimateHours: number | null;
  priority: string | null;
  dueOn: string | null;
  linkedReference: string | null;
};

/**
 * Brief section 9: "a clear match is linked instead of duplicated" — linked
 * items create nothing. v3 (plan-first), brief 8: "puts them straight into
 * the proposed plan after confirmation" — for a week that's still draft,
 * `refreshDraftWeek` picks up the new task immediately (same engine the
 * Week page itself runs on open). An already-accepted week is deliberately
 * left alone here, same as everywhere else in v3 — it surfaces through the
 * "Things have changed" banner instead of being changed silently.
 */
export async function confirmPersonalTasks(items: ConfirmedPersonalTask[], fromDockedChat?: boolean) {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const toInsert = items
    .filter((item) => !item.linkedReference)
    .map((item) => ({
      user_id: user.id,
      name: item.name,
      estimate_hours: item.estimateHours,
      priority: item.priority,
      due_on: item.dueOn,
    }));

  if (toInsert.length > 0) {
    const { error } = await supabase.from("personal_tasks").insert(toInsert);
    if (error) throw new Error(error.message);

    const todayStr = utcInstantToLocal(new Date(), env.appTimezone()).dateStr;
    const weekStart = mondayOf(todayStr);
    const followingWeekStart = addDaysToDateStr(weekStart, 7);
    await refreshDraftWeek(weekStart);
    await refreshDraftWeek(followingWeekStart);
  }

  if (fromDockedChat) {
    const created = items.filter((i) => !i.linkedReference).length;
    const linked = items.length - created;
    await supabase.from("chat_messages").insert({
      user_id: user.id,
      week_start: currentWeekStart(),
      role: "assistant",
      content: `Added ${created} task${created === 1 ? "" : "s"}${linked > 0 ? `, linked ${linked} to existing tasks` : ""}.`,
    });
  }

  revalidatePath("/");
}

/** Brief section 9: priority overrides live only in `task_meta` — Asana is never changed. */
export async function confirmPriorityOverride(source: "asana" | "personal", reference: string, newPriority: string) {
  await setPriorityOverride(source, reference, newPriority);
}

/**
 * Moves and/or resizes the task's chronologically-last placed block. A null
 * `newDay`/`newDurationHours` keeps that dimension as it already was — "move
 * the Arran edit to Thursday" only changes the day; "give it another hour"
 * only changes the duration. If it has no placement yet, there's nothing to
 * move — surfaced as an error for the chat panel to show.
 */
export async function confirmPlanChange(
  source: "asana" | "personal",
  reference: string,
  newDay: string | null,
  newDurationHours?: number | null
) {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const { data: placements } = await supabase
    .from("plan_items")
    .select("id, day, start_time, end_time")
    .eq("user_id", user.id)
    .eq("source", source)
    .eq("reference", reference)
    .not("day", "is", null)
    .order("day", { ascending: false });

  const target = placements?.[0];
  if (!target) {
    throw new Error("That task isn't placed on the calendar yet, so there's nothing to move.");
  }

  const day = newDay ?? (target.day as string);
  const startMinutes = parseHHMM(target.start_time as string);
  const endMinutes = newDurationHours ? startMinutes + newDurationHours * 60 : parseHHMM(target.end_time as string);

  return moveBlock(mondayOf(day), target.id, source, reference, day, startMinutes, endMinutes, {
    stage: null,
    focusType: null,
    videoType: null,
  });
}

export async function confirmMustChange(source: "asana" | "personal", reference: string, must: boolean) {
  const weekStart = currentWeekStart();
  await setPlanMust(weekStart, source, reference, must);
}

export async function confirmRemoveBlock(source: "asana" | "personal", reference: string) {
  const supabase = await createClient();
  const user = await requireUser(supabase);
  const weekStart = currentWeekStart();
  const { data: rows } = await supabase
    .from("plan_items")
    .select("id, must")
    .eq("user_id", user.id)
    .eq("source", source)
    .eq("reference", reference)
    .not("day", "is", null);
  const row = rows?.[0];
  if (!row) throw new Error("That task isn't on the calendar.");
  await removeBlock(weekStart, row.id, source, reference, row.must);
}

export async function confirmParkChange(source: "asana" | "personal", reference: string, parked: boolean) {
  await setParked(source, reference, parked);
}

export async function confirmSetEstimate(source: "asana" | "personal", reference: string, hours: number) {
  await setTaskEstimate(source, reference, hours, { stage: null, focusType: null, videoType: null });
}

export async function confirmIdeas(items: { title: string }[], fromDockedChat?: boolean) {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  if (items.length > 0) {
    const { error } = await supabase
      .from("ideas")
      .insert(items.map((item) => ({ user_id: user.id, title: item.title })));
    if (error) throw new Error(error.message);
  }

  if (fromDockedChat) {
    await supabase.from("chat_messages").insert({
      user_id: user.id,
      week_start: currentWeekStart(),
      role: "assistant",
      content: `Added ${items.length} idea${items.length === 1 ? "" : "s"}.`,
    });
  }

  revalidatePath("/ideas");
}
