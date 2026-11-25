"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { classifyChatMessage, type ChatHistoryMessage } from "@/lib/chat/claude";
import { buildChatContext, loadExistingTaskNames } from "@/lib/chat/context";
import { findCandidateMatches, type MatchCandidate } from "@/lib/chat/match";
import { setPriorityOverride, setParked, setTaskEstimate } from "@/app/(app)/tasks/actions";
import { moveBlock, setPlanMust, removeBlock, splitBlock, reprioritiseFromDay } from "@/app/(app)/plan/actions";
import { setDayLock } from "@/app/(app)/capacity/actions";
import { resolveNewDurationMinutes } from "@/lib/chat/duration-change";
import { refreshDraftWeek } from "@/app/(app)/plan/build-actions";
import { addDaysToDateStr, localToUtcInstant, mondayOf, parseHHMM, utcInstantToLocal } from "@/lib/time";
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

export type ChatProposalAction =
  | { type: "monday_list"; items: MondayListProposalItem[] }
  | { type: "idea"; items: { title: string }[] }
  | { type: "priority_override"; taskName: string; newPriority: string; candidates: MatchCandidate[] }
  | { type: "plan_change"; taskName: string; newDay: string | null; newDurationHours: number | null; candidates: MatchCandidate[] }
  | { type: "must_change"; taskName: string; must: boolean; candidates: MatchCandidate[] }
  | { type: "remove_block"; taskName: string; candidates: MatchCandidate[] }
  | { type: "park_change"; taskName: string; parked: boolean; candidates: MatchCandidate[] }
  | { type: "set_estimate"; taskName: string; hours: number; candidates: MatchCandidate[] }
  | { type: "split_block"; taskName: string; hoursNow: number; remainder: "next-working-day" | "queue"; candidates: MatchCandidate[] };

/**
 * `text` is what gets shown as the assistant's chat bubble — the model's own
 * words when it had any (a real reply, not a template), otherwise a plain
 * code-written fallback. `proposal` is set only when something still needs
 * reviewing (an ambiguous match, or a Monday-list/idea draft); null means
 * either pure conversation or an edit that already auto-applied.
 */
export type ChatProposal = { text: string; proposal: ChatProposalAction | null };

export type ChatHistoryEntry = { role: "user" | "assistant"; content: string };

/**
 * `dailySummaryText` (lib/summary.ts's `formatDailySummaryText`, same facts
 * as the old WeekSummary card) is spliced in as the first message of today —
 * ahead of today's first real message if there is one, else appended after
 * every earlier day's — rather than persisted, so it's always the live
 * figures, recomputed on every load, the same way the card it replaces was.
 */
export async function loadChatHistory(dailySummaryText: string): Promise<ChatHistoryEntry[]> {
  const supabase = await createClient();
  const user = await requireUser(supabase);
  const { data } = await supabase
    .from("chat_messages")
    .select("role, content, created_at")
    .eq("user_id", user.id)
    .eq("week_start", currentWeekStart())
    .order("created_at", { ascending: true });
  const rows = (data ?? []) as { role: "user" | "assistant"; content: string; created_at: string }[];

  const todayStr = utcInstantToLocal(new Date(), env.appTimezone()).dateStr;
  const todayStartIso = localToUtcInstant(todayStr, 0, env.appTimezone()).toISOString();
  const history: ChatHistoryEntry[] = rows.map((r) => ({ role: r.role, content: r.content }));
  const firstTodayIndex = rows.findIndex((r) => r.created_at >= todayStartIso);
  const summaryEntry: ChatHistoryEntry = { role: "assistant", content: dailySummaryText };
  if (firstTodayIndex === -1) {
    history.push(summaryEntry);
  } else {
    history.splice(firstTodayIndex, 0, summaryEntry);
  }
  return history;
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
export async function sendChatMessage(
  message: string,
  options?: { editTools?: boolean; history?: ChatHistoryMessage[] }
): Promise<ChatProposal> {
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
    const text = "Regenerated the unpinned part of the draft.";
    await logChatTurn(persist, supabase, user.id, weekStart, message, text);
    return { text, proposal: null };
  }

  const contextBlock = await buildChatContext(supabase, user.id);
  const classification = await classifyChatMessage(message, contextBlock, options?.history ?? [], {
    includeEditTools: options?.editTools ?? false,
  });

  // Pure conversation this turn — the model discussed, asked, or flagged a
  // concern rather than acting. Nothing to write; just show its reply.
  if (!classification.action) {
    const text = classification.text ?? "";
    await logChatTurn(persist, supabase, user.id, weekStart, message, text);
    return { text, proposal: null };
  }

  const action = classification.action;
  const modelText = classification.text?.trim() || null;

  if (action.type === "monday_list") {
    const existingNames = await loadExistingTaskNames(supabase, user.id);
    const items: MondayListProposalItem[] = action.items.map((item) => ({
      ...item,
      candidates: findCandidateMatches(item.name, existingNames),
    }));
    const text = modelText ?? `Reviewing ${items.length} item${items.length === 1 ? "" : "s"} for your task list.`;
    await logChatTurn(persist, supabase, user.id, weekStart, message, text);
    return { text, proposal: { type: "monday_list", items } };
  }

  if (action.type === "idea") {
    const text = modelText ?? `Reviewing ${action.items.length} idea${action.items.length === 1 ? "" : "s"}.`;
    await logChatTurn(persist, supabase, user.id, weekStart, message, text);
    return { text, proposal: { type: "idea", items: action.items } };
  }

  if (action.type === "priority_override") {
    const existingNames = await loadExistingTaskNames(supabase, user.id);
    const candidates = findCandidateMatches(action.taskName, existingNames);
    if (candidates.length === 1) {
      await setPriorityOverride(candidates[0].source, candidates[0].reference, action.newPriority);
      const text = modelText ?? `Set priority to ${action.newPriority} for ${candidates[0].name}.`;
      await logChatTurn(persist, supabase, user.id, weekStart, message, text);
      return { text, proposal: null };
    }
    const text = modelText ?? `Which task should get priority ${action.newPriority}?`;
    await logChatTurn(persist, supabase, user.id, weekStart, message, text);
    return { text, proposal: { type: "priority_override", taskName: action.taskName, newPriority: action.newPriority, candidates } };
  }

  if (action.type === "plan_change") {
    const existingNames = await loadExistingTaskNames(supabase, user.id);
    const candidates = findCandidateMatches(action.taskName, existingNames);
    // v5 (Week-view audit fix): used to also require `action.newDay` here,
    // so a resize-only request ("give it another hour") could never
    // auto-confirm even with one unambiguous match — it fell through to the
    // picker every time, contradicting this file's own stated design ("a
    // plan-editing tool executes immediately when the name match is
    // unambiguous"). A day change, a duration change, or a relative duration
    // change all count as a real request now.
    const hasChange = action.newDay != null || action.newDurationHours != null || action.durationDeltaHours != null;
    if (candidates.length === 1 && hasChange) {
      try {
        const moveResult = await confirmPlanChange(
          candidates[0].source,
          candidates[0].reference,
          action.newDay,
          action.newDurationHours,
          action.durationDeltaHours
        );
        const changeBits = [
          action.newDay ? `to ${action.newDay}` : null,
          action.newDurationHours ? `${action.newDurationHours}h` : null,
          action.durationDeltaHours ? `${action.durationDeltaHours > 0 ? "+" : ""}${action.durationDeltaHours}h` : null,
        ].filter((b): b is string => b != null);
        // resolveDrop can redirect a block to the nearest free slot instead
        // of the exact spot asked for — sometimes right back where it
        // already was, if nothing else was open — or ripple other blocks out
        // of the way. There's no visual re-render to catch that in chat the
        // way the Week screen's own drag-drop has, so this overrides even
        // the model's own narration (which has no way to know that happened)
        // with resolveDrop's own summary of what actually landed.
        const text = !moveResult.landedAsRequested
          ? moveResult.resolveDropSummary
          : modelText ?? `Moved ${candidates[0].name}${changeBits.length > 0 ? ` (${changeBits.join(", ")})` : ""}.`;
        await logChatTurn(persist, supabase, user.id, weekStart, message, text);
        return { text, proposal: null };
      } catch (err) {
        const text = err instanceof Error ? err.message : "Couldn't move that task.";
        await logChatTurn(persist, supabase, user.id, weekStart, message, text);
        return { text, proposal: null };
      }
    }
    if (!hasChange) {
      const text = modelText ?? `I didn't catch what to change for ${action.taskName} — a new day, a new duration, or how much to add/remove.`;
      await logChatTurn(persist, supabase, user.id, weekStart, message, text);
      return { text, proposal: null };
    }
    const text = modelText ?? `Which task do you mean?`;
    await logChatTurn(persist, supabase, user.id, weekStart, message, text);
    return {
      text,
      proposal: { type: "plan_change", taskName: action.taskName, newDay: action.newDay, newDurationHours: action.newDurationHours, candidates },
    };
  }

  if (action.type === "must_change") {
    const existingNames = await loadExistingTaskNames(supabase, user.id);
    const candidates = findCandidateMatches(action.taskName, existingNames);
    if (candidates.length === 1) {
      await setPlanMust(weekStart, candidates[0].source, candidates[0].reference, action.must);
      const text = modelText ?? `${action.must ? "Flagged" : "Cleared Must on"} ${candidates[0].name}${action.must ? " as Must" : ""}.`;
      await logChatTurn(persist, supabase, user.id, weekStart, message, text);
      return { text, proposal: null };
    }
    const text = modelText ?? `Which task do you mean?`;
    await logChatTurn(persist, supabase, user.id, weekStart, message, text);
    return { text, proposal: { type: "must_change", taskName: action.taskName, must: action.must, candidates } };
  }

  if (action.type === "remove_block") {
    const existingNames = await loadExistingTaskNames(supabase, user.id);
    const candidates = findCandidateMatches(action.taskName, existingNames);
    if (candidates.length === 1) {
      const resultText = await removeMatchedBlock(supabase, user.id, weekStart, candidates[0]);
      const text = modelText ?? resultText;
      await logChatTurn(persist, supabase, user.id, weekStart, message, text);
      return { text, proposal: null };
    }
    const text = modelText ?? `Which task do you mean?`;
    await logChatTurn(persist, supabase, user.id, weekStart, message, text);
    return { text, proposal: { type: "remove_block", taskName: action.taskName, candidates } };
  }

  if (action.type === "park_change") {
    const existingNames = await loadExistingTaskNames(supabase, user.id);
    const candidates = findCandidateMatches(action.taskName, existingNames);
    if (candidates.length === 1) {
      await setParked(candidates[0].source, candidates[0].reference, action.parked);
      const text = modelText ?? `${action.parked ? "Parked" : "Unparked"} ${candidates[0].name}.`;
      await logChatTurn(persist, supabase, user.id, weekStart, message, text);
      return { text, proposal: null };
    }
    const text = modelText ?? `Which task do you mean?`;
    await logChatTurn(persist, supabase, user.id, weekStart, message, text);
    return { text, proposal: { type: "park_change", taskName: action.taskName, parked: action.parked, candidates } };
  }

  if (action.type === "set_estimate") {
    const existingNames = await loadExistingTaskNames(supabase, user.id);
    const candidates = findCandidateMatches(action.taskName, existingNames);
    if (candidates.length === 1) {
      // No stage/focus/video-type context is cheaply available for an
      // arbitrary name match here, so the "learned" tier won't pick this up
      // for other tasks of the same type — only this exact task's own figure
      // (tier 1) is set, which is still the main thing being asked for.
      await setTaskEstimate(candidates[0].source, candidates[0].reference, action.hours, { stage: null, focusType: null, videoType: null });
      const text = modelText ?? `Set ${candidates[0].name} to ${action.hours}h.`;
      await logChatTurn(persist, supabase, user.id, weekStart, message, text);
      return { text, proposal: null };
    }
    const text = modelText ?? `Which task do you mean?`;
    await logChatTurn(persist, supabase, user.id, weekStart, message, text);
    return { text, proposal: { type: "set_estimate", taskName: action.taskName, hours: action.hours, candidates } };
  }

  if (action.type === "split_block") {
    const existingNames = await loadExistingTaskNames(supabase, user.id);
    const candidates = findCandidateMatches(action.taskName, existingNames);
    if (candidates.length === 1) {
      try {
        const resultText = await splitMatchedBlock(supabase, user.id, candidates[0], action.hoursNow, action.remainder);
        const text = modelText ?? resultText;
        await logChatTurn(persist, supabase, user.id, weekStart, message, text);
        return { text, proposal: null };
      } catch (err) {
        const text = err instanceof Error ? err.message : "Couldn't split that task.";
        await logChatTurn(persist, supabase, user.id, weekStart, message, text);
        return { text, proposal: null };
      }
    }
    const text = modelText ?? `Which task do you mean?`;
    await logChatTurn(persist, supabase, user.id, weekStart, message, text);
    return {
      text,
      proposal: { type: "split_block", taskName: action.taskName, hoursNow: action.hoursNow, remainder: action.remainder, candidates },
    };
  }

  // action.type === "day_lock" — day-based, not task-based, so there's never ambiguity to resolve; apply immediately.
  if (action.type === "day_lock") {
    try {
      await setDayLock(action.day, action.locked, action.reason ?? undefined);
      const text = modelText ?? (action.locked ? `Locked ${action.day} as out of office.` : `Unlocked ${action.day}.`);
      await logChatTurn(persist, supabase, user.id, weekStart, message, text);
      return { text, proposal: null };
    } catch (err) {
      const text = err instanceof Error ? err.message : "Couldn't update that day's lock.";
      await logChatTurn(persist, supabase, user.id, weekStart, message, text);
      return { text, proposal: null };
    }
  }

  // action.type === "reprioritise_day" — day-based, not task-based, so there's never ambiguity to resolve; apply immediately like "regenerate".
  const day = action.day ?? utcInstantToLocal(new Date(), env.appTimezone()).dateStr;
  try {
    await reprioritiseFromDay(day);
    const text = modelText ?? `Closed the gap on ${day}.`;
    await logChatTurn(persist, supabase, user.id, weekStart, message, text);
    return { text, proposal: null };
  } catch (err) {
    const text = err instanceof Error ? err.message : "Couldn't re-prioritise that day.";
    await logChatTurn(persist, supabase, user.id, weekStart, message, text);
    return { text, proposal: null };
  }
}

async function splitMatchedBlock(
  supabase: SupabaseClient,
  userId: string,
  candidate: MatchCandidate,
  hoursNow: number,
  remainder: "next-working-day" | "queue"
): Promise<string> {
  const { data: rows } = await supabase
    .from("plan_items")
    .select("id")
    .eq("user_id", userId)
    .eq("source", candidate.source)
    .eq("reference", candidate.reference)
    .not("day", "is", null)
    .order("day", { ascending: false });
  const row = rows?.[0];
  if (!row) throw new Error(`${candidate.name} isn't placed on the calendar, so there's nothing to split.`);
  const result = await splitBlock(row.id, candidate.source, candidate.reference, hoursNow, { kind: remainder });
  // Same redirect risk as a move — "the rest to the next working day" is
  // only true when resolveDrop actually managed to put it there.
  if (!result.landedAsRequested) return result.resolveDropSummary;
  return `Split ${candidate.name} — ${hoursNow}h now, the rest to ${remainder === "queue" ? "the unscheduled queue" : "the next working day"}.`;
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
export async function confirmPersonalTasks(items: ConfirmedPersonalTask[], fromDockedChat?: boolean): Promise<{ text: string; unfitNames: string[] }> {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const toCreate = items.filter((item) => !item.linkedReference);
  const toInsert = toCreate.map((item) => ({
    user_id: user.id,
    name: item.name,
    estimate_hours: item.estimateHours,
    priority: item.priority,
    due_on: item.dueOn,
  }));

  let unfitNames: string[] = [];
  if (toInsert.length > 0) {
    const { data: inserted, error } = await supabase.from("personal_tasks").insert(toInsert).select("id, name");
    if (error) throw new Error(error.message);

    const todayStr = utcInstantToLocal(new Date(), env.appTimezone()).dateStr;
    const weekStart = mondayOf(todayStr);
    const followingWeekStart = addDaysToDateStr(weekStart, 7);
    await refreshDraftWeek(weekStart);
    await refreshDraftWeek(followingWeekStart);

    // Did everything just created actually land on a day? A code-computed
    // check, not left to the model or to the user noticing it themselves in
    // the Unscheduled queue — "arithmetic is code" extends to "did it
    // actually fit" too.
    const newRows = inserted ?? [];
    if (newRows.length > 0) {
      const { data: placedCheck } = await supabase
        .from("plan_items")
        .select("reference, day")
        .eq("source", "personal")
        .in("reference", newRows.map((r) => r.id as string));
      const placedRefs = new Set((placedCheck ?? []).filter((r) => r.day != null).map((r) => r.reference as string));
      unfitNames = newRows.filter((r) => !placedRefs.has(r.id as string)).map((r) => r.name as string);
    }
  }

  const created = toCreate.length;
  const linked = items.length - created;
  // Not "this week" specifically — a new task can be due either week, so
  // whichever week's build it was eligible for is the one that couldn't
  // place it; naming both would be more precise but isn't worth a second
  // query here.
  const unfitNote =
    unfitNames.length > 0
      ? ` Heads up — ${unfitNames.length === 1 ? "it didn't get placed" : "they didn't all get placed"}: ${unfitNames.join(", ")} still need${unfitNames.length === 1 ? "s" : ""} room.`
      : "";
  const text = `Added ${created} task${created === 1 ? "" : "s"}${linked > 0 ? `, linked ${linked} to existing tasks` : ""}.${unfitNote}`;

  if (fromDockedChat) {
    await supabase.from("chat_messages").insert({ user_id: user.id, week_start: currentWeekStart(), role: "assistant", content: text });
  }

  revalidatePath("/");
  return { text, unfitNames };
}

/** Brief section 9: priority overrides live only in `task_meta` — Asana is never changed. */
export async function confirmPriorityOverride(source: "asana" | "personal", reference: string, newPriority: string) {
  await setPriorityOverride(source, reference, newPriority);
}

/**
 * Moves and/or resizes the task's chronologically-last placed block. A null
 * `newDay`/`newDurationHours` keeps that dimension as it already was — "move
 * the Arran edit to Thursday" only changes the day; "give it another hour"
 * only changes the duration (via `durationDeltaHours` — brief rule 2,
 * "arithmetic is code": the model is never asked to work out a new total
 * itself since it has no way to know the current one, only to say how much
 * to add or remove, and the real current duration looked up below does the
 * actual sum). If it has no placement yet, there's nothing to move —
 * surfaced as an error for the chat panel to show.
 */
export async function confirmPlanChange(
  source: "asana" | "personal",
  reference: string,
  newDay: string | null,
  newDurationHours?: number | null,
  durationDeltaHours?: number | null
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
  const oldDuration = parseHHMM(target.end_time as string) - startMinutes;
  const newDuration = resolveNewDurationMinutes(oldDuration, newDurationHours, durationDeltaHours);
  const endMinutes = startMinutes + newDuration;
  if (endMinutes <= startMinutes) {
    throw new Error("That would leave it with no time at all — try a smaller change.");
  }

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

export async function confirmSplitBlock(
  source: "asana" | "personal",
  reference: string,
  hoursNow: number,
  remainder: "next-working-day" | "queue"
) {
  const supabase = await createClient();
  const user = await requireUser(supabase);
  const { data: rows } = await supabase
    .from("plan_items")
    .select("id")
    .eq("user_id", user.id)
    .eq("source", source)
    .eq("reference", reference)
    .not("day", "is", null)
    .order("day", { ascending: false });
  const row = rows?.[0];
  if (!row) throw new Error("That task isn't placed on the calendar, so there's nothing to split.");
  return splitBlock(row.id, source, reference, hoursNow, { kind: remainder });
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
