"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";
import { setTaskEstimate } from "@/app/(app)/tasks/actions";
import { loadSettings } from "@/lib/settings-data";
import { getWeekCapacity } from "@/lib/calendar/week-capacity";
import { mondayOf, utcInstantToLocal, formatHHMM, parseHHMM } from "@/lib/time";
import { env } from "@/lib/env";
import {
  mergeAdjacentBlocks,
  rangeFitsInFreeBlocks,
  snapTo15,
  splitBlockAt,
  subtractOccupied,
  type BlockRef,
  type Range,
} from "@/lib/blocks";
import { blockerWarning, type BlockerTask } from "@/lib/asana/dependencies";

async function requireUser(supabase: SupabaseClient): Promise<User> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  return data.user;
}

type Source = "asana" | "personal";
type EstimateContext = { stage: string | null; focusType: string | null; videoType: string | null };

async function loadDayBlocks(
  supabase: SupabaseClient,
  userId: string,
  weekStart: string,
  day: string
): Promise<BlockRef[]> {
  const { data } = await supabase
    .from("plan_items")
    .select("id, source, reference, day, start_time, end_time")
    .eq("user_id", userId)
    .eq("week_start", weekStart)
    .eq("day", day)
    .not("start_time", "is", null)
    .not("end_time", "is", null);

  return (data ?? []).map((r) => ({
    id: r.id as string,
    source: r.source as string,
    reference: r.reference as string,
    day: r.day as string,
    startMinutes: parseHHMM(r.start_time as string),
    endMinutes: parseHHMM(r.end_time as string),
  }));
}

/** Free blocks for manual placement = the day's calendar-free time minus whatever's already placed there. */
async function getFreeBlocksForPlacement(
  supabase: SupabaseClient,
  userId: string,
  weekStart: string,
  day: string,
  excludeBlockId?: string
): Promise<Range[]> {
  const settings = await loadSettings(supabase, userId);
  const timezone = env.appTimezone();
  const todayStr = utcInstantToLocal(new Date(), timezone).dateStr;
  const useActualStarts = weekStart === mondayOf(todayStr);

  const days = await getWeekCapacity(supabase, userId, timezone, settings, weekStart, { useActualStarts });
  const dayView = days.find((d) => d.dateStr === day);
  if (!dayView) return [];

  const blocks = await loadDayBlocks(supabase, userId, weekStart, day);
  const occupied = blocks
    .filter((b) => b.id !== excludeBlockId)
    .map((b) => ({ startMinutes: b.startMinutes, endMinutes: b.endMinutes }));

  return subtractOccupied(dayView.freeBlocks, occupied);
}

async function applyMerges(supabase: SupabaseClient, userId: string, weekStart: string, day: string) {
  const blocks = await loadDayBlocks(supabase, userId, weekStart, day);
  const merges = mergeAdjacentBlocks(blocks);
  for (const { keep, absorbed } of merges) {
    await supabase
      .from("plan_items")
      .update({
        end_time: formatHHMM(keep.endMinutes),
        hours: (keep.endMinutes - keep.startMinutes) / 60,
        updated_at: new Date().toISOString(),
      })
      .eq("id", keep.id);
    await supabase
      .from("plan_items")
      .delete()
      .in(
        "id",
        absorbed.map((a) => a.id)
      );
  }
}

async function removeUnplacedRow(supabase: SupabaseClient, userId: string, weekStart: string, source: Source, reference: string) {
  await supabase
    .from("plan_items")
    .delete()
    .eq("user_id", userId)
    .eq("week_start", weekStart)
    .eq("source", source)
    .eq("reference", reference)
    .is("day", null);
}

/**
 * v2 (18 Nov 2026), item B.8: `blocked_by_gids` drives a warning only —
 * placement is never blocked by it.
 */
async function checkBlockerWarning(
  supabase: SupabaseClient,
  source: Source,
  reference: string
): Promise<string | undefined> {
  if (source !== "asana") return undefined;

  const { data: task } = await supabase
    .from("asana_tasks")
    .select("blocked_by_gids")
    .eq("gid", reference)
    .maybeSingle();
  const blockedByGids = (task?.blocked_by_gids as string[] | undefined) ?? [];
  if (blockedByGids.length === 0) return undefined;

  const { data: blockers } = await supabase.from("asana_tasks").select("gid, name, completed").in("gid", blockedByGids);
  return blockerWarning((blockers ?? []) as BlockerTask[]);
}

async function reinstateUnplacedIfOrphaned(
  supabase: SupabaseClient,
  userId: string,
  weekStart: string,
  source: Source,
  reference: string,
  must: boolean
) {
  const { data: remaining } = await supabase
    .from("plan_items")
    .select("id")
    .eq("user_id", userId)
    .eq("week_start", weekStart)
    .eq("source", source)
    .eq("reference", reference);

  if (!remaining || remaining.length === 0) {
    await supabase.from("plan_items").insert({
      user_id: userId,
      week_start: weekStart,
      source,
      reference,
      day: null,
      hours: null,
      must,
      status: "planned",
    });
  }
}

/** Proposal section 3: drag an unplaced task onto a free slot on the grid. */
export async function placeBlock(
  weekStart: string,
  source: Source,
  reference: string,
  day: string,
  startMinutesRaw: number,
  endMinutesRaw: number
) {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const startMinutes = snapTo15(startMinutesRaw);
  const endMinutes = snapTo15(endMinutesRaw);
  const free = await getFreeBlocksForPlacement(supabase, user.id, weekStart, day);
  if (!rangeFitsInFreeBlocks({ startMinutes, endMinutes }, free)) {
    throw new Error("That slot isn't free");
  }

  await removeUnplacedRow(supabase, user.id, weekStart, source, reference);
  await supabase.from("plan_items").insert({
    user_id: user.id,
    week_start: weekStart,
    source,
    reference,
    day,
    start_time: formatHHMM(startMinutes),
    end_time: formatHHMM(endMinutes),
    hours: (endMinutes - startMinutes) / 60,
    must: false,
    status: "planned",
    pinned: true, // v3: placed by hand — re-planning never moves it (brief 3.5)
  });
  await applyMerges(supabase, user.id, weekStart, day);

  revalidatePath("/");
  return { warning: await checkBlockerWarning(supabase, source, reference) };
}

/**
 * Proposal section 3: drag a block's body to move it (same day or a
 * different day) or its edge to resize it. A real duration change also
 * becomes the task's confirmed estimate (decision 8.2).
 */
export async function moveBlock(
  weekStart: string,
  blockId: string,
  source: Source,
  reference: string,
  day: string,
  startMinutesRaw: number,
  endMinutesRaw: number,
  estimateContext?: EstimateContext
) {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const { data: existing } = await supabase
    .from("plan_items")
    .select("start_time, end_time, status")
    .eq("id", blockId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!existing) throw new Error("Block not found");
  const oldDuration = parseHHMM(existing.end_time as string) - parseHHMM(existing.start_time as string);
  const wasSuggested = existing.status === "suggested";

  const startMinutes = snapTo15(startMinutesRaw);
  const endMinutes = snapTo15(endMinutesRaw);
  const free = await getFreeBlocksForPlacement(supabase, user.id, weekStart, day, blockId);
  if (!rangeFitsInFreeBlocks({ startMinutes, endMinutes }, free)) {
    throw new Error("That slot isn't free");
  }

  await supabase
    .from("plan_items")
    .update({
      week_start: weekStart,
      day,
      start_time: formatHHMM(startMinutes),
      end_time: formatHHMM(endMinutes),
      hours: (endMinutes - startMinutes) / 60,
      pinned: true, // v3: moved/resized by hand — re-planning never moves it (brief 3.5)
      ...(wasSuggested ? { status: "planned" } : {}), // v4 Stage 2 5.1: resizing a suggested block confirms it
      updated_at: new Date().toISOString(),
    })
    .eq("id", blockId);
  await applyMerges(supabase, user.id, weekStart, day);

  const newDuration = endMinutes - startMinutes;
  // A real duration change, or confirming a suggested estimate at all (even
  // at its existing duration), both count as "typing a real estimate" and
  // get written back as the task's confirmed estimate — remembered for the
  // same stage and video type via the existing "learned" tier.
  if ((newDuration !== oldDuration || wasSuggested) && estimateContext) {
    await setTaskEstimate(source, reference, newDuration / 60, estimateContext);
  }

  revalidatePath("/");
  return { warning: await checkBlockerWarning(supabase, source, reference) };
}

/**
 * v4 Stage 2, brief section 5.1: "One tap confirms it" — accepts a
 * suggested block exactly as placed, with no resize needed. Pins the
 * block and writes the suggested hours back as the user's confirmed
 * estimate, same as the resize path, just without touching day/time.
 */
export async function confirmSuggestedEstimate(blockId: string, source: Source, reference: string, estimateContext: EstimateContext) {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const { data: existing } = await supabase
    .from("plan_items")
    .select("status, hours")
    .eq("id", blockId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!existing || existing.status !== "suggested") return;

  await supabase
    .from("plan_items")
    .update({ status: "planned", pinned: true, updated_at: new Date().toISOString() })
    .eq("id", blockId);
  await setTaskEstimate(source, reference, Number(existing.hours), estimateContext);

  revalidatePath("/");
}

/**
 * Proposal section 4: drop task B onto the middle of A's block. Splits A
 * into before/after pieces and inserts B between them, capped to whatever
 * room is left.
 */
export async function splitBlock(
  weekStart: string,
  targetBlockId: string,
  insertSource: Source,
  insertReference: string,
  insertStartMinutesRaw: number,
  insertDurationMinutes: number
) {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const { data: target } = await supabase
    .from("plan_items")
    .select("source, reference, day, start_time, end_time, must, status, pinned")
    .eq("id", targetBlockId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!target) throw new Error("Block not found");

  const existingRange = { startMinutes: parseHHMM(target.start_time as string), endMinutes: parseHHMM(target.end_time as string) };
  const result = splitBlockAt(existingRange, insertStartMinutesRaw, insertDurationMinutes);
  const day = target.day as string;

  await supabase.from("plan_items").delete().eq("id", targetBlockId);

  for (const piece of [result.before, result.after]) {
    if (!piece) continue;
    await supabase.from("plan_items").insert({
      user_id: user.id,
      week_start: weekStart,
      source: target.source,
      reference: target.reference,
      day,
      start_time: formatHHMM(piece.startMinutes),
      end_time: formatHHMM(piece.endMinutes),
      hours: (piece.endMinutes - piece.startMinutes) / 60,
      must: target.must,
      status: target.status,
      pinned: target.pinned,
    });
  }

  await removeUnplacedRow(supabase, user.id, weekStart, insertSource, insertReference);
  await supabase.from("plan_items").insert({
    user_id: user.id,
    week_start: weekStart,
    source: insertSource,
    reference: insertReference,
    day,
    start_time: formatHHMM(result.inserted.startMinutes),
    end_time: formatHHMM(result.inserted.endMinutes),
    hours: (result.inserted.endMinutes - result.inserted.startMinutes) / 60,
    must: false,
    status: "planned",
    pinned: true, // v3: placed by hand — re-planning never moves it (brief 3.5)
  });

  await applyMerges(supabase, user.id, weekStart, day);

  revalidatePath("/");
  return { warning: await checkBlockerWarning(supabase, insertSource, insertReference) };
}

/**
 * v4 Stage 2, brief section 5.5: "Alongside Accept plan, each draft block
 * can be approved or rejected." Approving a single proposed block just
 * pins it in place — the same thing accepting the whole week does to every
 * block at once, scoped to one.
 */
export async function approveDraftBlock(blockId: string) {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  await supabase.from("plan_items").update({ pinned: true, updated_at: new Date().toISOString() }).eq("id", blockId).eq("user_id", user.id);

  revalidatePath("/");
}

export async function removeBlock(weekStart: string, blockId: string, source: Source, reference: string, must: boolean) {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  await supabase.from("plan_items").delete().eq("id", blockId).eq("user_id", user.id);
  await reinstateUnplacedIfOrphaned(supabase, user.id, weekStart, source, reference, must);

  revalidatePath("/");
}

/** Scoped to the task, not one week — it may have unplaced/placed rows under either week shown. */
export async function setPlanMust(weekStart: string, source: Source, reference: string, must: boolean) {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const { data: existingRows } = await supabase
    .from("plan_items")
    .select("id")
    .eq("user_id", user.id)
    .eq("source", source)
    .eq("reference", reference);

  if (existingRows && existingRows.length > 0) {
    await supabase
      .from("plan_items")
      .update({ must, updated_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("source", source)
      .eq("reference", reference);
  } else if (must) {
    await supabase.from("plan_items").insert({
      user_id: user.id,
      week_start: weekStart,
      source,
      reference,
      day: null,
      hours: null,
      must: true,
      status: "planned",
    });
  }

  revalidatePath("/");
}

/** Brief section 8: "or was pulled in by the user" — adds it to this week, unplaced. */
export async function pullIntoWeek(weekStart: string, source: Source, reference: string) {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const { data: existing } = await supabase
    .from("plan_items")
    .select("id")
    .eq("user_id", user.id)
    .eq("week_start", weekStart)
    .eq("source", source)
    .eq("reference", reference)
    .maybeSingle();

  if (!existing) {
    await supabase.from("plan_items").insert({
      user_id: user.id,
      week_start: weekStart,
      source,
      reference,
      day: null,
      hours: null,
      must: false,
      status: "planned",
    });
  }

  revalidatePath("/");
}

/** Scoped to the task, not one week — removes it from planning wherever it's staged. */
export async function removeFromWeek(source: Source, reference: string) {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  await supabase.from("plan_items").delete().eq("user_id", user.id).eq("source", source).eq("reference", reference);

  revalidatePath("/");
}

/** Record keeper: mark a placed block done, with the actual hours it took. */
export async function markDone(weekStart: string, blockId: string, actualHours: number) {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  await supabase
    .from("plan_items")
    .update({ status: "done", actual_hours: actualHours, updated_at: new Date().toISOString() })
    .eq("id", blockId)
    .eq("user_id", user.id);

  revalidatePath("/");
}

export async function markNotDone(weekStart: string, blockId: string) {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  await supabase
    .from("plan_items")
    .update({ status: "planned", actual_hours: null, updated_at: new Date().toISOString() })
    .eq("id", blockId)
    .eq("user_id", user.id);

  revalidatePath("/");
}

/**
 * `allThisWeekRefs` is every task currently shown as "this week" on the
 * client, including ones only there via the live due-this-week/overdue
 * check (not yet backed by a plan_items row). Saving must turn those into
 * real rows first — otherwise they vanish the instant status flips to
 * "saved", since the live check stops running once a plan is saved (brief:
 * "a saved plan reloads exactly").
 */
export async function saveWeekPlan(
  weekStart: string,
  capacitySnapshot: unknown,
  allThisWeekRefs: { source: Source; reference: string; must: boolean }[]
) {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const { data: existingRows } = await supabase
    .from("plan_items")
    .select("source, reference")
    .eq("user_id", user.id)
    .eq("week_start", weekStart);
  const existingKeys = new Set((existingRows ?? []).map((r) => `${r.source}:${r.reference}`));

  const toInsert = allThisWeekRefs
    .filter((t) => !existingKeys.has(`${t.source}:${t.reference}`))
    .map((t) => ({
      user_id: user.id,
      week_start: weekStart,
      source: t.source,
      reference: t.reference,
      day: null,
      hours: null,
      must: t.must,
      status: "planned",
    }));

  if (toInsert.length > 0) {
    await supabase.from("plan_items").insert(toInsert);
  }

  await supabase.from("weeks").upsert({
    user_id: user.id,
    week_start: weekStart,
    status: "saved",
    capacity_snapshot: capacitySnapshot,
    saved_at: new Date().toISOString(),
  });

  // v4 Stage 2, brief 5.4: "Reset it when the week is accepted or the user clears it."
  await supabase.from("chat_messages").delete().eq("user_id", user.id).eq("week_start", weekStart);

  revalidatePath("/");
}
