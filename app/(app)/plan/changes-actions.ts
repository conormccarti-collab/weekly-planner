"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { orderCandidatesForPlacement, proposeAutoPlacement } from "@/lib/auto-placement";
import { gatherWeekBuildInputs } from "@/lib/plan-build-data";
import { formatHHMM } from "@/lib/time";

async function requireUser(supabase: SupabaseClient): Promise<User> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  return data.user;
}

export type NewPlanItem = {
  source: "asana" | "personal";
  reference: string;
  name: string;
  day: string;
  startMinutes: number;
  endMinutes: number;
  isSuggested: boolean;
};

export type WeekChanges = {
  weekStart: string;
  newItems: NewPlanItem[];
  needsEstimate: { source: "asana" | "personal"; reference: string; name: string }[];
};

/**
 * v3 (plan-first), brief 3.4: "Things have changed. Review a new proposal?"
 * Once a week is accepted, nothing rebuilds it silently — this only
 * detects genuinely new eligible tasks (a new task from Asana, something
 * newly flagged Must or now due) that have no row in the plan yet, and
 * proposes placing them into whatever free time remains, respecting every
 * already-accepted block as fixed. Scoped deliberately to additions, not a
 * full reshuffle-against-frozen-baseline diff — see the stage 2 write-up.
 */
export async function computeWeekChanges(weekStart: string): Promise<WeekChanges | null> {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const { data: weekRow } = await supabase.from("weeks").select("status").eq("user_id", user.id).eq("week_start", weekStart).maybeSingle();
  if (weekRow?.status !== "saved") return null; // only accepted weeks use this path — drafts refresh silently

  const inputs = await gatherWeekBuildInputs(supabase, user, weekStart, { treatAllExistingAsProtected: true });

  // Every accepted row is protected by `treatAllExistingAsProtected`, so
  // `toRank` here is already exactly "eligible candidates with no row yet."
  if (inputs.toRank.length === 0 && inputs.needsEstimatePick.length === 0) return null;

  const ordered = orderCandidatesForPlacement(inputs.toRank);
  const { placements, unplaced } = proposeAutoPlacement(ordered, inputs.freeBlocksByDay, inputs.dayOrder);

  const suggestedByKey = new Map(inputs.candidates.map((c) => [`${c.source}:${c.reference}`, c.isSuggested]));
  const newItems: NewPlanItem[] = placements.map((p) => ({
    source: p.source,
    reference: p.reference,
    name: inputs.nameByKey.get(`${p.source}:${p.reference}`) ?? p.reference,
    day: p.day,
    startMinutes: p.startMinutes,
    endMinutes: p.endMinutes,
    isSuggested: suggestedByKey.get(`${p.source}:${p.reference}`) ?? false,
  }));
  // A new task that couldn't be placed at all (no free room this week) is
  // still a real change — it must not be silently dropped just because it
  // didn't make it onto the calendar.
  const needsEstimate = [
    ...inputs.needsEstimatePick.map((u) => ({ ...u, name: inputs.nameByKey.get(`${u.source}:${u.reference}`) ?? u.reference })),
    ...unplaced.map((u) => ({ source: u.source, reference: u.reference, name: inputs.nameByKey.get(`${u.source}:${u.reference}`) ?? u.reference })),
  ];

  if (newItems.length === 0 && needsEstimate.length === 0) return null;
  return { weekStart, newItems, needsEstimate };
}

/** Approve: writes exactly the proposed new rows — every existing row is untouched. */
export async function applyWeekChanges(weekStart: string, items: NewPlanItem[], needsEstimate: { source: "asana" | "personal"; reference: string }[]) {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const rows = [
    ...items.map((p) => ({
      user_id: user.id,
      week_start: weekStart,
      source: p.source,
      reference: p.reference,
      day: p.day,
      start_time: formatHHMM(p.startMinutes),
      end_time: formatHHMM(p.endMinutes),
      hours: (p.endMinutes - p.startMinutes) / 60,
      must: false,
      status: p.isSuggested ? "suggested" : "planned",
      pinned: false,
    })),
    ...needsEstimate.map((u) => ({
      user_id: user.id,
      week_start: weekStart,
      source: u.source,
      reference: u.reference,
      day: null,
      hours: null,
      must: false,
      status: "planned",
      pinned: false,
    })),
  ];
  if (rows.length === 0) return;

  const { error } = await supabase.from("plan_items").insert(rows);
  if (error) throw new Error(`Failed to apply the new proposal: ${error.message}`);

  revalidatePath("/");
}
