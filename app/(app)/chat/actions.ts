"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { classifyChatMessage } from "@/lib/chat/claude";
import { buildChatContext, loadExistingTaskNames } from "@/lib/chat/context";
import { findCandidateMatches, type MatchCandidate } from "@/lib/chat/match";
import { setPriorityOverride } from "@/app/(app)/tasks/actions";
import { moveBlock } from "@/app/(app)/plan/actions";
import { refreshDraftWeek } from "@/app/(app)/plan/build-actions";
import { addDaysToDateStr, mondayOf, parseHHMM, utcInstantToLocal } from "@/lib/time";
import { env } from "@/lib/env";

async function requireUser(supabase: SupabaseClient): Promise<User> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  return data.user;
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
  | { type: "plan_change"; taskName: string; newDay: string | null; candidates: MatchCandidate[] };

/** Nothing is created here — this only classifies and matches, for the user to review. */
export async function sendChatMessage(message: string): Promise<ChatProposal> {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const contextBlock = await buildChatContext(supabase, user.id);
  const classification = await classifyChatMessage(message, contextBlock);

  if (classification.type === "monday_list") {
    const existingNames = await loadExistingTaskNames(supabase, user.id);
    const items: MondayListProposalItem[] = classification.items.map((item) => ({
      ...item,
      candidates: findCandidateMatches(item.name, existingNames),
    }));
    return { type: "monday_list", items };
  }

  if (classification.type === "idea") {
    return { type: "idea", items: classification.items };
  }

  if (classification.type === "priority_override") {
    const existingNames = await loadExistingTaskNames(supabase, user.id);
    return {
      type: "priority_override",
      taskName: classification.taskName,
      newPriority: classification.newPriority,
      candidates: findCandidateMatches(classification.taskName, existingNames, { minScore: 0 }),
    };
  }

  if (classification.type === "plan_change") {
    const existingNames = await loadExistingTaskNames(supabase, user.id);
    return {
      type: "plan_change",
      taskName: classification.taskName,
      newDay: classification.newDay,
      candidates: findCandidateMatches(classification.taskName, existingNames, { minScore: 0 }),
    };
  }

  return { type: "answer", text: classification.answerText };
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
export async function confirmPersonalTasks(items: ConfirmedPersonalTask[]) {
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

  revalidatePath("/");
}

/** Brief section 9: priority overrides live only in `task_meta` — Asana is never changed. */
export async function confirmPriorityOverride(source: "asana" | "personal", reference: string, newPriority: string) {
  await setPriorityOverride(source, reference, newPriority);
}

/**
 * Moves the task's chronologically-last placed block to the new day, at the
 * same start time and duration. If it has no placement yet, there's nothing
 * to move — surfaced as an error for the chat panel to show.
 */
export async function confirmPlanChange(source: "asana" | "personal", reference: string, newDay: string) {
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

  const startMinutes = parseHHMM(target.start_time as string);
  const endMinutes = parseHHMM(target.end_time as string);

  return moveBlock(mondayOf(newDay), target.id, source, reference, newDay, startMinutes, endMinutes);
}

export async function confirmIdeas(items: { title: string }[]) {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  if (items.length > 0) {
    const { error } = await supabase
      .from("ideas")
      .insert(items.map((item) => ({ user_id: user.id, title: item.title })));
    if (error) throw new Error(error.message);
  }

  revalidatePath("/ideas");
}
