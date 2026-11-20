"use server";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { buildWeekPlan } from "@/lib/plan-build";
import { gatherWeekBuildInputs } from "@/lib/plan-build-data";
import { addDaysToDateStr, formatHHMM, utcInstantToLocal } from "@/lib/time";
import { env } from "@/lib/env";

async function requireUser(supabase: SupabaseClient): Promise<User> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  return data.user;
}

/**
 * v3 (plan-first), brief sections 3.1/4.1: builds or refreshes a draft
 * week's plan automatically — "no button is needed." Pinned, Done/Behind,
 * and past-dated rows are protected (brief 3.5); everything else is
 * recomputed from scratch, so this is safe to call on every page load while
 * the week is still draft. A `saved` (accepted) week is left untouched here
 * — that's the "Things have changed" banner's job instead (stage 2).
 */
export async function refreshDraftWeek(weekStart: string): Promise<void> {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const { data: weekRow, error: weekRowError } = await supabase
    .from("weeks")
    .select("status")
    .eq("user_id", user.id)
    .eq("week_start", weekStart)
    .maybeSingle();
  if (weekRowError) throw new Error(`Failed to load week status: ${weekRowError.message}`);
  if (!weekRow) {
    const { error } = await supabase.from("weeks").insert({ user_id: user.id, week_start: weekStart, status: "draft" });
    // A concurrent call may have created this same week row first — that's fine, carry on as draft either way.
    if (error && error.code !== "23505") throw new Error(`Failed to create draft week: ${error.message}`);
  } else if (weekRow.status === "saved") {
    return;
  }

  const inputs = await gatherWeekBuildInputs(supabase, user, weekStart);
  const result = buildWeekPlan(inputs.toRank, inputs.freeBlocksByDay, inputs.dayOrder, inputs.weekCapacityHours, inputs.completedByGid);

  const rowsToInsert: Record<string, unknown>[] = [];
  for (const p of result.placements) {
    rowsToInsert.push({
      source: p.source,
      reference: p.reference,
      day: p.day,
      start_time: formatHHMM(p.startMinutes),
      end_time: formatHHMM(p.endMinutes),
      hours: (p.endMinutes - p.startMinutes) / 60,
      must: inputs.mustByKey.get(`${p.source}:${p.reference}`) ?? false,
      status: p.isSuggested ? "suggested" : "planned",
      pinned: false,
    });
  }
  for (const m of result.movedToNextWeek) {
    rowsToInsert.push({ source: m.source, reference: m.reference, day: null, hours: null, must: false, status: "moved", pinned: false });
  }
  for (const u of [...result.stillUnplaced, ...inputs.needsEstimatePick]) {
    rowsToInsert.push({
      source: u.source,
      reference: u.reference,
      day: null,
      hours: null,
      must: inputs.mustByKey.get(`${u.source}:${u.reference}`) ?? false,
      status: "planned",
      pinned: false,
    });
  }

  const followingWeekStart = addDaysToDateStr(weekStart, 7);
  const todayStr = utcInstantToLocal(new Date(), env.appTimezone()).dateStr;

  // The delete-then-insert used to be two separate round trips computed
  // from this function's own (possibly stale, under overlapping calls)
  // read of existing rows. This RPC re-derives what's unprotected at the
  // moment it runs, inside an advisory lock, so overlapping invocations
  // can't each independently insert their own full duplicate set.
  const { error: rpcError } = await supabase.rpc("refresh_draft_week_items", {
    p_user_id: user.id,
    p_week_start: weekStart,
    p_today: todayStr,
    p_insert_rows: rowsToInsert,
    p_following_week_start: followingWeekStart,
    p_moved_rows: result.movedToNextWeek.map((m) => ({ source: m.source, reference: m.reference })),
  });
  if (rpcError) {
    // v4 Stage 2 writes `status: 'suggested'` rows, which migration 0017
    // (renaming the 'provisional' constraint value) must land before this
    // can succeed. Until then, a check-constraint failure here must not
    // take down the whole Week page — it just means this refresh didn't
    // happen; the week renders from whatever's already stored. A failure
    // for any other reason still surfaces the same way (console, not silent).
    console.error(`refreshDraftWeek: failed to write the rebuilt plan for ${weekStart}: ${rpcError.message}`);
    return;
  }
}
