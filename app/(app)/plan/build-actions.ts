"use server";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { buildWeekPlan } from "@/lib/plan-build";
import { gatherWeekBuildInputs } from "@/lib/plan-build-data";
import { runWorkAheadFill } from "@/app/(app)/plan/actions";
import { addDaysToDateStr, formatHHMM, utcInstantToLocal } from "@/lib/time";
import { env } from "@/lib/env";

async function requireUser(supabase: SupabaseClient): Promise<User> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  return data.user;
}

/**
 * v3 (plan-first), brief sections 3.1/4.1: builds or refreshes a week's
 * plan. Pinned and Done/Behind rows are protected (brief 3.5); everything
 * else is recomputed from scratch. (Week-list rebuild: there is no more
 * "accepted/saved" status to leave untouched — the schedule is always
 * live, and row-level protection is what already keeps manual work safe,
 * same as it always has for a draft week.)
 *
 * A past-dated row used to be protected purely by having already
 * happened, regardless of status, pinned included — but a block that's
 * still "planned" (never confirmed Done/Behind/Moved) once its day has
 * passed isn't manual work worth preserving in place, it's just
 * unconfirmed, and is swept back into the unplaced queue below before
 * every rebuild (clearing any pin too) so it gets a genuinely new slot
 * going forward instead of sitting frozen.
 *
 * v5 Stage 12c: this is deliberately **not** called from the Week page's
 * render path any more — "the page load must be read-only." It's called
 * instead from the four events the brief names: a sync completing (the two
 * `/api/sync/*` routes), a user action (chat, the Regenerate button —
 * unchanged), the daily cron (`/api/cron/daily-build`), and implicitly on
 * week rollover (the same daily cron, for whichever week is current that
 * day). The input-hash check below means none of those call sites need to
 * be clever about "did anything actually change" themselves — calling this
 * with unchanged inputs is always a safe, writeless no-op.
 */
export async function refreshDraftWeekFor(supabase: SupabaseClient, userId: string, weekStart: string): Promise<void> {
  let weekRow: { status: string; input_hash: string | null } | null;
  {
    const { data, error } = await supabase.from("weeks").select("status, input_hash").eq("user_id", userId).eq("week_start", weekStart).maybeSingle();
    if (error) {
      // Migration 0022 (weeks.input_hash) may not be applied yet — fall back
      // to the pre-Stage-12c behaviour (always rebuild, see the hash check
      // below) rather than failing whatever called this.
      const fallback = await supabase.from("weeks").select("status").eq("user_id", userId).eq("week_start", weekStart).maybeSingle();
      if (fallback.error) throw new Error(`Failed to load week status: ${fallback.error.message}`);
      weekRow = fallback.data ? { status: fallback.data.status, input_hash: null } : null;
    } else {
      weekRow = data;
    }
  }
  const isNewWeek = !weekRow;
  if (!weekRow) {
    const { error } = await supabase.from("weeks").insert({ user_id: userId, week_start: weekStart, status: "draft" });
    // A concurrent call may have created this same week row first — that's fine, carry on as draft either way.
    if (error && error.code !== "23505") throw new Error(`Failed to create draft week: ${error.message}`);
  }

  // A block whose day has already passed without being marked Done,
  // Behind or Moved isn't finished work — it's just unconfirmed, and the
  // user expects it to move forward on the next refresh rather than sit
  // frozen on a day that's gone. Swept back into the unplaced queue
  // (day/time cleared) here, before gathering inputs below, so the normal
  // build gives it a genuinely new, still-future slot. Pinned doesn't
  // exempt it: pinning only means "don't reshuffle this among the current
  // options," not "freeze it here even once its day is gone."
  if (!isNewWeek) {
    const todayStr = utcInstantToLocal(new Date(), env.appTimezone()).dateStr;
    await supabase
      .from("plan_items")
      .update({ day: null, start_time: null, end_time: null, pinned: false })
      .eq("user_id", userId)
      .eq("week_start", weekStart)
      .in("status", ["planned", "suggested"])
      .lt("day", todayStr);
  }

  const inputs = await gatherWeekBuildInputs(supabase, userId, weekStart);

  if (!isNewWeek && weekRow?.input_hash === inputs.inputHash) {
    return; // nothing that would change the outcome has changed since the last build — no write
  }

  const result = buildWeekPlan(
    inputs.toRank,
    inputs.freeBlocksByDay,
    inputs.dayOrder,
    inputs.weekCapacityHours,
    inputs.completedByGid,
    inputs.avoidSlotByKey,
    inputs.dayExcludedForCandidate,
    inputs.minSplitPartMinutes
  );

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
  for (const u of result.stillUnplaced) {
    rowsToInsert.push({
      source: u.source,
      reference: u.reference,
      day: null,
      hours: null,
      must: inputs.mustByKey.get(`${u.source}:${u.reference}`) ?? false,
      status: "planned",
      pinned: false,
      reason: u.reason,
    });
  }
  for (const u of inputs.needsEstimatePick) {
    rowsToInsert.push({
      source: u.source,
      reference: u.reference,
      day: null,
      hours: null,
      must: inputs.mustByKey.get(`${u.source}:${u.reference}`) ?? false,
      status: "planned",
      pinned: false,
      reason: "Needs an estimate",
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
    p_user_id: userId,
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

  // Best-effort — if migration 0022 isn't applied yet this column write
  // fails silently and every call just rebuilds unconditionally until it is.
  await supabase.from("weeks").update({ input_hash: inputs.inputHash }).eq("user_id", userId).eq("week_start", weekStart);

  // v5 Stage 13a: "once everything required is placed, remaining capacity
  // is filled with the next unstarted stage of the earliest-due
  // deliverables, marked ahead." Runs automatically now, not just via the
  // explicit "Fill slack" button — a failure here must not undo the
  // required placement that just succeeded above.
  try {
    await runWorkAheadFill(supabase, userId, weekStart);
  } catch (err) {
    console.error(`refreshDraftWeek: work-ahead-fill failed for ${weekStart}: ${err instanceof Error ? err.message : err}`);
  }
}

/** Session-based wrapper for call sites that already have a signed-in request (chat, the Regenerate button). */
export async function refreshDraftWeek(weekStart: string): Promise<void> {
  const supabase = await createClient();
  const user = await requireUser(supabase);
  return refreshDraftWeekFor(supabase, user.id, weekStart);
}
