"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";
import { setTaskEstimate } from "@/app/(app)/tasks/actions";
import { loadSettings } from "@/lib/settings-data";
import { getWeekCapacity } from "@/lib/calendar/week-capacity";
import { addDaysToDateStr, addWorkingDays, mondayOf, utcInstantToLocal, formatHHMM, parseHHMM, weekdayOfDateStr } from "@/lib/time";
import { env } from "@/lib/env";
import { mergeAdjacentBlocks, snapTo15, type BlockRef } from "@/lib/blocks";
import { resolveDrop, type DayShape, type DropChange, type ExistingBlock } from "@/lib/resolve-drop";
import { blockerWarning, type BlockerTask } from "@/lib/asana/dependencies";
import { splitHours } from "@/lib/split";
import { closeGapsFrom } from "@/lib/reprioritise";
import { freeBlocksFromCurrentPlacements, computeSlackFill } from "@/lib/work-ahead-fill";
import { gatherWeekBuildInputs } from "@/lib/plan-build-data";
import { createCheckoffReminder, retractCheckoffReminder } from "@/lib/reminders";

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
async function lookupTaskNames(
  supabase: SupabaseClient,
  refs: { source: Source; reference: string }[]
): Promise<Map<string, string>> {
  const asanaGids = [...new Set(refs.filter((r) => r.source === "asana").map((r) => r.reference))];
  const personalIds = [...new Set(refs.filter((r) => r.source === "personal").map((r) => r.reference))];
  const [asanaRows, personalRows] = await Promise.all([
    asanaGids.length > 0 ? supabase.from("asana_tasks").select("gid, name").in("gid", asanaGids) : Promise.resolve({ data: [] }),
    personalIds.length > 0 ? supabase.from("personal_tasks").select("id, name").in("id", personalIds) : Promise.resolve({ data: [] }),
  ]);
  const nameByKey = new Map<string, string>();
  for (const r of (asanaRows.data ?? []) as { gid: string; name: string }[]) nameByKey.set(`asana:${r.gid}`, r.name);
  for (const r of (personalRows.data ?? []) as { id: string; name: string }[]) nameByKey.set(`personal:${r.id}`, r.name);
  return nameByKey;
}

/**
 * v5 Stage 12g §A: the server-side counterpart to the client's live
 * drag-preview build (same shape, same data) — gathers everything
 * resolveDrop needs: every working day's window/free-time across the
 * target week and the week after (so an overflow has somewhere to land),
 * and every other currently-placed block across both.
 */
export async function buildDropContext(
  supabase: SupabaseClient,
  userId: string,
  targetDay: string,
  excludeBlockId: string | null
): Promise<{ days: DayShape[]; blocks: ExistingBlock[] }> {
  const settings = await loadSettings(supabase, userId);
  const timezone = env.appTimezone();
  const todayStr = utcInstantToLocal(new Date(), timezone).dateStr;
  const targetWeekStart = mondayOf(targetDay);
  const followingWeekStart = addDaysToDateStr(targetWeekStart, 7);

  const [targetWeekDays, followingWeekDays] = await Promise.all([
    getWeekCapacity(supabase, userId, timezone, settings, targetWeekStart, { useActualStarts: targetWeekStart === mondayOf(todayStr) }),
    getWeekCapacity(supabase, userId, timezone, settings, followingWeekStart, { useActualStarts: false }),
  ]);
  const dayViews = [...targetWeekDays, ...followingWeekDays];
  const days: DayShape[] = dayViews.map((d) => ({
    day: d.dateStr,
    windowStartMinutes: d.windowStartMinutes,
    windowEndMinutes: d.windowEndMinutes,
    calendarFreeBlocks: d.freeBlocks,
    isWorkingDay: d.isWorkingDay,
  }));

  const { data: rows } = await supabase
    .from("plan_items")
    .select("id, source, reference, day, start_time, end_time, pinned, status")
    .eq("user_id", userId)
    .in("week_start", [targetWeekStart, followingWeekStart])
    .not("day", "is", null)
    .not("start_time", "is", null)
    .not("end_time", "is", null);

  const otherRows = (rows ?? []).filter((r) => r.id !== excludeBlockId);
  const nameByKey = await lookupTaskNames(
    supabase,
    otherRows.map((r) => ({ source: r.source as Source, reference: r.reference as string }))
  );

  const blocks: ExistingBlock[] = otherRows.map((r) => ({
    id: r.id as string,
    source: r.source as Source,
    reference: r.reference as string,
    name: nameByKey.get(`${r.source}:${r.reference}`) ?? "another task",
    day: r.day as string,
    startMinutes: parseHHMM(r.start_time as string),
    endMinutes: parseHHMM(r.end_time as string),
    pinned: r.pinned as boolean,
    done: r.status === "done",
  }));

  return { days, blocks };
}

/**
 * v5 Stage 12g §A: applies whatever resolveDrop decided — the dropped
 * block's own row (by id, or a fresh insert when it was previously
 * unplaced), every pushed/split part of another block (first part updates
 * that block's existing row in place; any further part is a new row), and
 * anything that ended up in Unplaced (existing row cleared back to day:null).
 */
export async function applyDropChanges(supabase: SupabaseClient, userId: string, movingBlockId: string | null, changes: DropChange[]) {
  const placed = changes.filter((c): c is DropChange & { kind: "placed" } => c.kind === "placed");
  const unplaced = changes.filter((c): c is DropChange & { kind: "unplaced" } => c.kind === "unplaced");

  const knownBlockIds = [...new Set([...placed.map((c) => c.blockId).filter((id): id is string => id != null), ...unplaced.map((c) => c.blockId)])];
  const { data: existingRows } = knownBlockIds.length > 0
    ? await supabase.from("plan_items").select("id, must, status, week_start").in("id", knownBlockIds)
    : { data: [] };
  const existingById = new Map((existingRows ?? []).map((r) => [r.id as string, r]));

  // Group placed parts by task so a multi-part split knows which row is
  // "first" (reuses the existing row, or the moving block's row) vs. a new
  // fragment that needs inserting.
  const byTask = new Map<string, (DropChange & { kind: "placed" })[]>();
  for (const c of placed) {
    const key = `${c.source}:${c.reference}`;
    byTask.set(key, [...(byTask.get(key) ?? []), c]);
  }

  for (const [, parts] of byTask) {
    const anchorId = parts[0].blockId ?? movingBlockId;
    const existing = anchorId ? existingById.get(anchorId) : undefined;
    const must = existing?.must ?? false;
    const wasSuggested = existing?.status === "suggested";

    for (const part of parts) {
      const row = {
        week_start: mondayOf(part.day),
        source: part.source,
        reference: part.reference,
        day: part.day,
        start_time: formatHHMM(part.startMinutes),
        end_time: formatHHMM(part.endMinutes),
        hours: (part.endMinutes - part.startMinutes) / 60,
        pinned: part.pinned,
        must,
        ...(wasSuggested ? { status: "planned" } : {}),
        updated_at: new Date().toISOString(),
      };
      if (part.blockId) {
        await supabase.from("plan_items").update(row).eq("id", part.blockId);
      } else {
        await supabase.from("plan_items").insert({ ...row, user_id: userId, status: existing?.status ?? "planned" });
      }
    }
  }

  for (const c of unplaced) {
    await supabase
      .from("plan_items")
      .update({ day: null, start_time: null, end_time: null, hours: null, pinned: false, updated_at: new Date().toISOString() })
      .eq("id", c.blockId);
  }

  const daysTouched = new Set(placed.map((c) => c.day));
  for (const day of daysTouched) {
    const weekStart = mondayOf(day);
    await applyMerges(supabase, userId, weekStart, day);
  }
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

/** A locked day never blocks a manual placement — only warns, same as a blocker. */
async function checkDayLockWarning(supabase: SupabaseClient, userId: string, day: string): Promise<string | undefined> {
  const { data } = await supabase.from("day_locks").select("reason").eq("user_id", userId).eq("date", day).maybeSingle();
  if (data) {
    const reason = data.reason as string | null;
    return `${day} is marked out of office${reason ? ` (${reason})` : ""} — placed anyway.`;
  }
  // Same check for a calendar-driven block (a real Out of Office entry, or
  // any all-day busy event) — getWeekCapacity treats both the same way for
  // the day-card's badge, so a manual placement should warn about either.
  const { data: calendarEvent } = await supabase
    .from("calendar_events")
    .select("title")
    .eq("user_id", userId)
    .eq("all_day", true)
    .eq("busy", true)
    .lte("start_date", day)
    .gt("end_date", day)
    .limit(1)
    .maybeSingle();
  if (!calendarEvent) return undefined;
  return `${day} is blocked by "${calendarEvent.title as string}" on your calendar — placed anyway.`;
}

/**
 * Same soft-warning treatment for a structured `avoid_weekday` rule. Only
 * checks whole-day rules (no stage filter) here — resolving a stage for an
 * arbitrary manual placement would need the full deliverable-group/stage
 * computation lib/plan-build-data.ts does for the weekly build, which is far
 * more than a soft warning on one placement warrants. A stage-filtered rule
 * still fully steers the deterministic auto-placement engine; it just isn't
 * cross-checked here.
 */
async function checkRuleWarning(supabase: SupabaseClient, userId: string, day: string): Promise<string | undefined> {
  const weekday = weekdayOfDateStr(day);
  const { data } = await supabase
    .from("scheduling_rules")
    .select("text")
    .eq("user_id", userId)
    .eq("active", true)
    .eq("parsed_kind", "avoid_weekday")
    .eq("parsed_weekday", weekday)
    .is("parsed_stage", null)
    .limit(1)
    .maybeSingle();
  if (!data) return undefined;
  return `This conflicts with the rule "${data.text as string}" — placed anyway.`;
}

function combineWarnings(...warnings: (string | undefined)[]): string | undefined {
  const present = warnings.filter((w): w is string => !!w);
  return present.length > 0 ? present.join(" ") : undefined;
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
/**
 * v5 (Week-view audit fix): this used to check only whether the single
 * [start, end) range fit on `day` and throw otherwise — so the tap
 * alternative to dragging (this is what "Place…" calls) couldn't do what the
 * brief requires it to: "split it across days by entering hours." Routed
 * through the same resolveDrop engine as a real drag so the two are
 * actually equivalent, not a full-featured path and a crippled one.
 */
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

  const durationMinutes = snapTo15(endMinutesRaw) - snapTo15(startMinutesRaw);
  const movingName = (await lookupTaskNames(supabase, [{ source, reference }])).get(`${source}:${reference}`) ?? "This task";
  const [{ days, blocks }, settings] = await Promise.all([
    buildDropContext(supabase, user.id, day, null),
    loadSettings(supabase, user.id),
  ]);

  const result = resolveDrop({
    moving: { id: null, source, reference, name: movingName, durationMinutes },
    target: { day, startMinutes: startMinutesRaw },
    days,
    blocks,
    minPartMinutes: settings.min_split_part_minutes,
  });
  if (!result.ok) throw new Error(result.reason);

  await applyDropChanges(supabase, user.id, null, result.changes);
  await removeUnplacedRow(supabase, user.id, weekStart, source, reference);

  revalidatePath("/");
  return {
    warning: combineWarnings(
      await checkBlockerWarning(supabase, source, reference),
      await checkDayLockWarning(supabase, user.id, day),
      await checkRuleWarning(supabase, user.id, day)
    ),
  };
}

/**
 * Proposal section 3: drag a block's body to move it (same day or a
 * different day), or use the tap-alternative popup editor to do the same by
 * typing day/time/duration — also the chat's "move the Arran edit to
 * Thursday" / "give it another hour" plan-change command. A real duration
 * change also becomes the task's confirmed estimate (decision 8.2).
 *
 * v5 (Week-view audit fix): same gap as placeBlock above — previously threw
 * on anything that didn't fit as one single-day range, instead of pushing
 * what's in the way or splitting across the day boundary the way a drag
 * already does. Now routed through the same resolveDrop engine.
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
    .select("day, start_time, end_time, status")
    .eq("id", blockId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!existing) throw new Error("Block not found");
  const oldDuration = parseHHMM(existing.end_time as string) - parseHHMM(existing.start_time as string);
  const wasSuggested = existing.status === "suggested";

  const durationMinutes = snapTo15(endMinutesRaw) - snapTo15(startMinutesRaw);
  const movingName = (await lookupTaskNames(supabase, [{ source, reference }])).get(`${source}:${reference}`) ?? "This task";
  const [{ days, blocks }, settings] = await Promise.all([
    buildDropContext(supabase, user.id, day, blockId),
    loadSettings(supabase, user.id),
  ]);

  const result = resolveDrop({
    moving: { id: blockId, source, reference, name: movingName, durationMinutes },
    target: { day, startMinutes: startMinutesRaw },
    days,
    blocks,
    minPartMinutes: settings.min_split_part_minutes,
  });
  if (!result.ok) throw new Error(result.reason);

  // resolveDrop can redirect a block away from the exact (day, startMinutes)
  // requested — onto the nearest genuinely free slot (which can even be the
  // block's own previous spot, when nothing else is open), or ripple other
  // blocks out of the way. A caller with no visual re-render to catch that
  // (the chat path) needs to know the move didn't land exactly as asked, so
  // it can say so — resolveDrop's own `summary` already describes the real
  // outcome (including any pushed/split side effects), so that's reused
  // verbatim rather than re-derived here.
  const landed = result.changes.filter(
    (c): c is Extract<DropChange, { kind: "placed" }> => c.kind === "placed" && c.source === source && c.reference === reference
  );
  const requestedStartMinutes = snapTo15(startMinutesRaw);
  const landedAsRequested =
    result.changes.length === 1 && landed.length === 1 && landed[0].day === day && landed[0].startMinutes === requestedStartMinutes;

  await applyDropChanges(supabase, user.id, blockId, result.changes);

  // A real duration change, or confirming a suggested estimate at all (even
  // at its existing duration), both count as "typing a real estimate" and
  // get written back as the task's confirmed estimate — remembered for the
  // same stage and video type via the existing "learned" tier.
  if ((durationMinutes !== oldDuration || wasSuggested) && estimateContext) {
    await setTaskEstimate(source, reference, durationMinutes / 60, estimateContext);
  }

  revalidatePath("/");

  return {
    warning: combineWarnings(
      await checkBlockerWarning(supabase, source, reference),
      await checkDayLockWarning(supabase, user.id, day),
      await checkRuleWarning(supabase, user.id, day)
    ),
    landedAsRequested,
    resolveDropSummary: result.summary,
  };
}

/**
 * v5 Stage 12g §A: "Insert-and-push." The real-drop counterpart to the
 * client's own live-preview call to the same pure resolveDrop — same
 * inputs gathered server-side instead of from client state, so a race
 * against another tab/device can't silently disagree with what the user
 * saw while dragging.
 */
export async function resolveAndApplyDrop(
  source: Source,
  reference: string,
  movingBlockId: string | null,
  durationMinutes: number,
  targetDay: string,
  targetStartMinutesRaw: number,
  estimateContext?: EstimateContext,
  replaceBlockId?: string
) {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const movingName = (await lookupTaskNames(supabase, [{ source, reference }])).get(`${source}:${reference}`) ?? "This task";
  const { days, blocks } = await buildDropContext(supabase, user.id, targetDay, movingBlockId);

  const settings = await loadSettings(supabase, user.id);
  const result = resolveDrop({
    moving: { id: movingBlockId, source, reference, name: movingName, durationMinutes },
    target: { day: targetDay, startMinutes: targetStartMinutesRaw },
    days,
    blocks,
    replaceBlockId,
    minPartMinutes: settings.min_split_part_minutes,
  });

  if (!result.ok) {
    return result;
  }

  let wasSuggested = false;
  if (movingBlockId) {
    const { data: existing } = await supabase.from("plan_items").select("status").eq("id", movingBlockId).maybeSingle();
    wasSuggested = existing?.status === "suggested";
  }

  const undo = await captureDropUndoSnapshot(supabase, user.id, source, reference, days, result.changes);
  await applyDropChanges(supabase, user.id, movingBlockId, result.changes);

  if (!movingBlockId) {
    await removeUnplacedRow(supabase, user.id, mondayOf(targetDay), source, reference);
  }
  if (wasSuggested && estimateContext) {
    await setTaskEstimate(source, reference, durationMinutes / 60, estimateContext);
  }

  revalidatePath("/");

  // Same "did it land exactly where asked" signal moveBlock exposes — a
  // caller with no visual re-render to catch a resolveDrop redirect (the
  // chat path, here via splitBlock's remainder) needs it to say so honestly.
  const landedAsRequested =
    result.changes.length === 1 &&
    result.changes[0].kind === "placed" &&
    result.changes[0].day === targetDay &&
    result.changes[0].startMinutes === snapTo15(targetStartMinutesRaw);

  return {
    ok: true as const,
    summary: result.summary,
    warning: await checkBlockerWarning(supabase, source, reference),
    undo,
    landedAsRequested,
  };
}

export type DropUndoSnapshot = {
  weekStarts: string[];
  tasks: {
    source: Source;
    reference: string;
    rows: { day: string | null; startMinutes: number | null; endMinutes: number | null; pinned: boolean; status: string; must: boolean }[];
  }[];
};

/**
 * v5 Stage 12g §A: "After the drop show a toast saying what moved, with
 * Undo." Captured before resolveDrop's changes are applied — every row,
 * for every task the drop touched (the dragged one plus anything pushed or
 * split), exactly as it stood beforehand.
 */
async function captureDropUndoSnapshot(
  supabase: SupabaseClient,
  userId: string,
  movingSource: Source,
  movingReference: string,
  days: DayShape[],
  changes: DropChange[]
): Promise<DropUndoSnapshot> {
  const touchedKeys = new Set<string>([`${movingSource}:${movingReference}`, ...changes.map((c) => `${c.source}:${c.reference}`)]);
  const weekStarts = [...new Set(days.map((d) => mondayOf(d.day)))];

  const { data: rows } = await supabase
    .from("plan_items")
    .select("source, reference, day, start_time, end_time, pinned, status, must")
    .eq("user_id", userId)
    .in("week_start", weekStarts);

  const tasksByKey = new Map<string, DropUndoSnapshot["tasks"][number]>();
  for (const r of rows ?? []) {
    const key = `${r.source}:${r.reference}`;
    if (!touchedKeys.has(key)) continue;
    const entry = tasksByKey.get(key) ?? { source: r.source as Source, reference: r.reference as string, rows: [] };
    entry.rows.push({
      day: r.day as string | null,
      startMinutes: r.start_time ? parseHHMM(r.start_time as string) : null,
      endMinutes: r.end_time ? parseHHMM(r.end_time as string) : null,
      pinned: r.pinned as boolean,
      status: r.status as string,
      must: r.must as boolean,
    });
    tasksByKey.set(key, entry);
  }

  return { weekStarts, tasks: [...tasksByKey.values()] };
}

/** v5 Stage 12g §A: restores every task resolveAndApplyDrop touched to exactly the rows captured just before it ran. */
export async function undoDrop(snapshot: DropUndoSnapshot) {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  for (const task of snapshot.tasks) {
    await supabase
      .from("plan_items")
      .delete()
      .eq("user_id", user.id)
      .eq("source", task.source)
      .eq("reference", task.reference)
      .in("week_start", snapshot.weekStarts);

    if (task.rows.length === 0) continue;
    await supabase.from("plan_items").insert(
      task.rows.map((r) => ({
        user_id: user.id,
        week_start: r.day ? mondayOf(r.day) : snapshot.weekStarts[0],
        source: task.source,
        reference: task.reference,
        day: r.day,
        start_time: r.day && r.startMinutes != null ? formatHHMM(r.startMinutes) : null,
        end_time: r.day && r.endMinutes != null ? formatHHMM(r.endMinutes) : null,
        hours: r.startMinutes != null && r.endMinutes != null ? (r.endMinutes - r.startMinutes) / 60 : null,
        pinned: r.pinned,
        status: r.status,
        must: r.must,
      }))
    );
  }

  revalidatePath("/");
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

export type RemovedBlockSlot = { day: string; startMinutes: number; endMinutes: number } | null;

/**
 * v5 Stage 12e.1: "Rejecting a block removes it at once, records the
 * rejection, keeps the task in the Unplaced list with its reason, shows a
 * confirmation with Undo, and regeneration does not put it back in the same
 * slot." Returns the removed slot (if it had one) so the caller can offer
 * Undo without a round trip, and so `proposeAutoPlacement` (via the new
 * `plan_events` row) skips re-proposing the exact same slot next time.
 */
export async function removeBlock(
  weekStart: string,
  blockId: string,
  source: Source,
  reference: string,
  must: boolean
): Promise<{ removedSlot: RemovedBlockSlot }> {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const { data: row } = await supabase
    .from("plan_items")
    .select("day, start_time, end_time")
    .eq("id", blockId)
    .eq("user_id", user.id)
    .maybeSingle();

  await supabase.from("plan_items").delete().eq("id", blockId).eq("user_id", user.id);
  await reinstateUnplacedIfOrphaned(supabase, user.id, weekStart, source, reference, must);

  const removedSlot: RemovedBlockSlot =
    row?.day && row.start_time && row.end_time
      ? { day: row.day as string, startMinutes: parseHHMM(row.start_time as string), endMinutes: parseHHMM(row.end_time as string) }
      : null;

  if (removedSlot) {
    // Best-effort — migration 0024 may not be applied yet; a failed insert
    // here must not break the remove itself.
    await supabase.from("plan_events").insert({
      user_id: user.id,
      event_type: "rejected",
      source,
      reference,
      week_start: weekStart,
      day: removedSlot.day,
      start_time: row!.start_time,
      end_time: row!.end_time,
    });
  }

  revalidatePath("/");
  return { removedSlot };
}

/** v5 Stage 12e.1: "shows a confirmation with Undo" — puts the block back exactly where it was and forgets the rejection. */
export async function undoReject(
  weekStart: string,
  source: Source,
  reference: string,
  day: string,
  startMinutes: number,
  endMinutes: number,
  must: boolean
) {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  // Remove whatever unplaced row the rejection left behind, then restore
  // the exact placement — pinned, since this is now an explicit user action.
  await supabase
    .from("plan_items")
    .delete()
    .eq("user_id", user.id)
    .eq("week_start", weekStart)
    .eq("source", source)
    .eq("reference", reference)
    .is("day", null);

  await supabase.from("plan_items").insert({
    user_id: user.id,
    week_start: weekStart,
    source,
    reference,
    day,
    start_time: formatHHMM(startMinutes),
    end_time: formatHHMM(endMinutes),
    hours: (endMinutes - startMinutes) / 60,
    must,
    status: "planned",
    pinned: true,
  });

  await supabase
    .from("plan_events")
    .delete()
    .eq("user_id", user.id)
    .eq("week_start", weekStart)
    .eq("source", source)
    .eq("reference", reference)
    .eq("event_type", "rejected")
    .eq("day", day)
    .eq("start_time", formatHHMM(startMinutes));

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

  const { data: existing } = await supabase
    .from("plan_items")
    .select("source, reference")
    .eq("id", blockId)
    .eq("user_id", user.id)
    .maybeSingle();

  await supabase
    .from("plan_items")
    .update({ status: "done", actual_hours: actualHours, updated_at: new Date().toISOString() })
    .eq("id", blockId)
    .eq("user_id", user.id);

  if (existing) {
    await createCheckoffReminder(supabase, user.id, existing.source as Source, existing.reference as string);
  }

  revalidatePath("/");
}

export async function markNotDone(weekStart: string, blockId: string) {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const { data: existing } = await supabase
    .from("plan_items")
    .select("source, reference")
    .eq("id", blockId)
    .eq("user_id", user.id)
    .maybeSingle();

  await supabase
    .from("plan_items")
    .update({ status: "planned", actual_hours: null, updated_at: new Date().toISOString() })
    .eq("id", blockId)
    .eq("user_id", user.id);

  if (existing) {
    await retractCheckoffReminder(supabase, user.id, existing.source as Source, existing.reference as string);
  }

  revalidatePath("/");
}

/**
 * "Finish early" — marks a block done and, if it took less time than
 * planned, pulls every later block that same day forward to close the gap
 * (closeGapsFrom, lib/reprioritise.ts — the mirror of resolveDrop's own
 * push cascade). Taking as long as planned or longer leaves everything else
 * exactly where it is, same as the plain markDone above.
 */
export async function markDoneAndCloseGap(blockId: string, actualHours: number) {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const { data: existing } = await supabase
    .from("plan_items")
    .select("day, start_time, end_time, source, reference")
    .eq("id", blockId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!existing || !existing.day || !existing.start_time || !existing.end_time) {
    throw new Error("That block isn't placed on the calendar.");
  }

  const day = existing.day as string;
  const startMinutes = parseHHMM(existing.start_time as string);
  const plannedEndMinutes = parseHHMM(existing.end_time as string);
  const actualEndMinutes = startMinutes + actualHours * 60;

  await createCheckoffReminder(supabase, user.id, existing.source as Source, existing.reference as string);

  if (actualEndMinutes >= plannedEndMinutes) {
    await supabase.from("plan_items").update({ status: "done", actual_hours: actualHours, updated_at: new Date().toISOString() }).eq("id", blockId);
    revalidatePath("/");
    return;
  }

  await supabase
    .from("plan_items")
    .update({
      status: "done",
      actual_hours: actualHours,
      end_time: formatHHMM(actualEndMinutes),
      hours: actualHours,
      updated_at: new Date().toISOString(),
    })
    .eq("id", blockId);

  const { days, blocks } = await buildDropContext(supabase, user.id, day, blockId);
  const { changes } = closeGapsFrom({
    anchor: { day, startMinutes: actualEndMinutes },
    days: days.filter((d) => d.day === day),
    blocks: blocks.filter((b) => b.day === day),
  });
  await applyDropChanges(supabase, user.id, null, changes);

  revalidatePath("/");
}

/**
 * The day card's "Re-prioritise" button — closes whatever gap sits between
 * now (or the day's start, for a future day) and the next thing on the
 * calendar, cascading forward from there through the rest of the visible
 * window. Confirmed scope: this only closes gaps, it never re-ranks by
 * priority/deadline and never pulls in extra backlog work.
 */
export async function reprioritiseFromDay(day: string) {
  const supabase = await createClient();
  const user = await requireUser(supabase);
  const nowLocal = utcInstantToLocal(new Date(), env.appTimezone());

  const { days, blocks } = await buildDropContext(supabase, user.id, day, null);
  const fromDayOnward = days.filter((d) => d.day >= day);
  const relevantBlocks = blocks.filter((b) => b.day >= day);
  const anchorStartMinutes = day === nowLocal.dateStr ? nowLocal.minutesFromMidnight : (fromDayOnward[0]?.windowStartMinutes ?? 0);

  const { changes } = closeGapsFrom({ anchor: { day, startMinutes: anchorStartMinutes }, days: fromDayOnward, blocks: relevantBlocks });
  await applyDropChanges(supabase, user.id, null, changes);

  revalidatePath("/");
}

/**
 * v5 brief Stage 13b.1: manual split — "choose the hours for the first
 * part, the rest becomes part two... total hours are conserved." Distinct
 * from the *automatic* splitting resolveDrop already does when a task
 * simply doesn't fit one gap: this is the user saying "I'm this far into it"
 * or "move the rest," for a block that may well fit fine where it is.
 */
export async function splitBlock(
  blockId: string,
  source: Source,
  reference: string,
  hoursNow: number,
  remainder: { kind: "next-working-day" } | { kind: "queue" }
) {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const { data: existing } = await supabase
    .from("plan_items")
    .select("week_start, day, start_time, end_time, must")
    .eq("id", blockId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!existing || !existing.day || !existing.start_time || !existing.end_time) {
    throw new Error("That block isn't placed on the calendar, so there's nothing to split.");
  }

  const startMinutes = parseHHMM(existing.start_time as string);
  const totalHours = (parseHHMM(existing.end_time as string) - startMinutes) / 60;
  const split = splitHours(totalHours, hoursNow);
  if (!split.ok) throw new Error(split.reason);

  const day = existing.day as string;
  const newEndMinutes = startMinutes + split.firstHours * 60;
  const { error: shrinkError } = await supabase
    .from("plan_items")
    .update({ end_time: formatHHMM(newEndMinutes), hours: split.firstHours, updated_at: new Date().toISOString() })
    .eq("id", blockId);
  if (shrinkError) throw new Error(shrinkError.message);
  await applyMerges(supabase, user.id, existing.week_start as string, day);

  if (remainder.kind === "queue") {
    await supabase.from("plan_items").insert({
      user_id: user.id,
      week_start: mondayOf(day),
      source,
      reference,
      day: null,
      hours: null,
      must: existing.must,
      status: "planned",
    });
    revalidatePath("/");
    return { landedAsRequested: true, resolveDropSummary: "" };
  }

  const settings = await loadSettings(supabase, user.id);
  const nextDay = addWorkingDays(day, 1, settings.working_days);
  // Same time of day as the part just closed off — resolveDrop pushes/splits
  // from there exactly as it would for any other placement if that slot
  // isn't actually free on the next day. Same "did it actually land where
  // asked" check as moveBlock — the chat path has no visual re-render to
  // catch a silent redirect, so it needs to know when "the rest to the next
  // working day" didn't literally happen that way.
  const result = await resolveAndApplyDrop(source, reference, null, split.remainderHours * 60, nextDay, startMinutes);
  if (!result.ok) throw new Error(result.reason);
  return { landedAsRequested: result.landedAsRequested, resolveDropSummary: result.summary };
}

/**
 * Work-ahead-fill: when `weekStart` has slack, pull forward extra eligible
 * work instead of leaving it empty, marking what lands this way `is_ahead`
 * (v5 Stage 13a) so it reads as optional/pulled-forward, not required.
 * Candidate pool is next week's own eligible queue (gatherWeekBuildInputs'
 * own eligibility gates: not parked, not blocked, not stale), minus
 * anything already placed somewhere — the full backlog beyond that is a
 * further reach not included here. Shared by the explicit "Fill slack"
 * button (`fillSlack` below) and the normal build, which now also runs this
 * automatically once required placement is done (`build-actions.ts`).
 */
export async function runWorkAheadFill(supabase: SupabaseClient, userId: string, weekStart: string): Promise<{ filledHours: number; count: number }> {
  const followingWeekStart = addDaysToDateStr(weekStart, 7);
  const weekEndExclusive = addDaysToDateStr(weekStart, 7);

  const [{ days, blocks }, nextWeekInputs, placedRows] = await Promise.all([
    buildDropContext(supabase, userId, weekStart, null),
    gatherWeekBuildInputs(supabase, userId, followingWeekStart),
    supabase.from("plan_items").select("source, reference").eq("user_id", userId).in("week_start", [weekStart, followingWeekStart]).not("day", "is", null),
  ]);

  const thisWeekDays = days.filter((d) => d.day >= weekStart && d.day < weekEndExclusive);
  const thisWeekBlocks = blocks.filter((b) => b.day >= weekStart && b.day < weekEndExclusive);
  const { freeBlocksByDay, dayOrder } = freeBlocksFromCurrentPlacements(thisWeekDays, thisWeekBlocks);

  const alreadyPlacedKeys = new Set((placedRows.data ?? []).map((r) => `${r.source}:${r.reference}`));
  const extraCandidates = nextWeekInputs.toRank.filter((c) => !alreadyPlacedKeys.has(`${c.source}:${c.reference}`));

  const { placements, filledHours } = computeSlackFill(extraCandidates, freeBlocksByDay, dayOrder);
  if (placements.length === 0) return { filledHours: 0, count: 0 };

  const nameByKey = await lookupTaskNames(supabase, placements.map((p) => ({ source: p.source, reference: p.reference })));
  const changes: DropChange[] = placements.map((p) => ({
    kind: "placed",
    blockId: null,
    source: p.source,
    reference: p.reference,
    name: nameByKey.get(`${p.source}:${p.reference}`) ?? "Task",
    day: p.day,
    startMinutes: p.startMinutes,
    endMinutes: p.endMinutes,
    pinned: false,
    ...(p.partIndex ? { partIndex: p.partIndex, partCount: p.partCount } : {}),
  }));
  await applyDropChanges(supabase, userId, null, changes);

  const filledRefs = [...new Set(placements.map((p) => `${p.source}:${p.reference}`))];
  await Promise.all(
    filledRefs.map((key) => {
      const [source, reference] = key.split(":") as [Source, string];
      return removeUnplacedRow(supabase, userId, followingWeekStart, source, reference);
    })
  );

  // Best-effort — migration 0030 may not be applied yet; a failure here
  // must not undo the placement itself, just the "ahead" label on it.
  await supabase
    .from("plan_items")
    .update({ is_ahead: true })
    .eq("user_id", userId)
    .eq("week_start", weekStart)
    .in(
      "reference",
      filledRefs.map((k) => k.split(":")[1])
    );

  return { filledHours, count: filledRefs.length };
}

export async function fillSlack(weekStart: string): Promise<{ filledHours: number; count: number }> {
  const supabase = await createClient();
  const user = await requireUser(supabase);
  const result = await runWorkAheadFill(supabase, user.id, weekStart);
  revalidatePath("/");
  return result;
}
