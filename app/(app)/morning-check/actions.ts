"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { loadSettings } from "@/lib/settings-data";
import { getWeekCapacity } from "@/lib/calendar/week-capacity";
import { mondayOf, utcInstantToLocal } from "@/lib/time";
import { env } from "@/lib/env";
import { resolveMorningCheckUpdate, type MorningCheckOutcome } from "@/lib/morning-check";

export type MorningCheckItem = {
  blockId: string;
  source: "asana" | "personal";
  reference: string;
  name: string;
  /** v5 Stage 12e.5: "Parent names on every subtask wherever a subtask is shown." */
  parentName: string | null;
  day: string;
  plannedHours: number;
};

export type MorningCheckData = {
  items: MorningCheckItem[];
  autoClosedCount: number;
  checkedDays: string[];
};

/**
 * Release 1.1, brief section 10: "Morning check... Days with zero
 * capacity are skipped, and missed mornings are caught up in one step."
 * Scoped to the current week (Monday through yesterday) — a day already
 * reviewed (`day_starts.morning_check_done`) isn't re-asked about.
 */
export async function computeMorningCheck(): Promise<MorningCheckData> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) throw new Error("Not signed in");
  return computeMorningCheckFor(supabase, user.id);
}

/**
 * v4 Stage 7: the morning-check-outstanding section of the daily
 * notification needs this same computation with no session (a cron
 * request, not a signed-in browser) — split out so both call sites share
 * one implementation rather than two copies drifting apart.
 */
export async function computeMorningCheckFor(supabase: SupabaseClient, userId: string): Promise<MorningCheckData> {
  const user = { id: userId };
  const timezone = env.appTimezone();
  const todayStr = utcInstantToLocal(new Date(), timezone).dateStr;
  const weekStart = mondayOf(todayStr);
  const settings = await loadSettings(supabase, user.id);
  const days = await getWeekCapacity(supabase, user.id, timezone, settings, weekStart, { useActualStarts: true });

  const priorDays = days.filter((d) => d.dateStr < todayStr && d.isWorkingDay && d.capacityHours > 0).map((d) => d.dateStr);
  if (priorDays.length === 0) return { items: [], autoClosedCount: 0, checkedDays: [] };

  const { data: dayStartRows } = await supabase
    .from("day_starts")
    .select("date, morning_check_done")
    .eq("user_id", user.id)
    .in("date", priorDays);
  const doneByDate = new Map((dayStartRows ?? []).map((r) => [r.date, r.morning_check_done]));
  const uncheckedDays = priorDays.filter((d) => !doneByDate.get(d));
  if (uncheckedDays.length === 0) return { items: [], autoClosedCount: 0, checkedDays: [] };

  const { data: placedRows } = await supabase
    .from("plan_items")
    .select("id, source, reference, day, hours")
    .eq("user_id", user.id)
    .eq("status", "planned")
    .in("day", uncheckedDays);

  const rows = placedRows ?? [];
  const asanaRefs = [...new Set(rows.filter((r) => r.source === "asana").map((r) => r.reference))];
  const personalRefs = [...new Set(rows.filter((r) => r.source === "personal").map((r) => r.reference))];

  const [asanaTasksResult, personalTasksResult] = await Promise.all([
    asanaRefs.length > 0
      ? supabase.from("asana_tasks").select("gid, name, parent_name, completed").in("gid", asanaRefs)
      : Promise.resolve({ data: [] as { gid: string; name: string; parent_name: string | null; completed: boolean }[] }),
    personalRefs.length > 0
      ? supabase.from("personal_tasks").select("id, name, completed").in("id", personalRefs)
      : Promise.resolve({ data: [] as { id: string; name: string; completed: boolean }[] }),
  ]);

  const asanaByGid = new Map((asanaTasksResult.data ?? []).map((t) => [t.gid, t]));
  const personalById = new Map((personalTasksResult.data ?? []).map((t) => [t.id, t]));

  const items: MorningCheckItem[] = [];
  const autoCloseIds: string[] = [];

  for (const row of rows) {
    const task = row.source === "asana" ? asanaByGid.get(row.reference) : personalById.get(row.reference);
    const name = task?.name ?? row.reference;
    // Brief section 10: "Tasks completed in Asana close themselves."
    if (task?.completed) {
      autoCloseIds.push(row.id);
      continue;
    }
    items.push({
      blockId: row.id,
      source: row.source as "asana" | "personal",
      reference: row.reference,
      name,
      parentName: row.source === "asana" ? (task as { parent_name: string | null } | undefined)?.parent_name ?? null : null,
      day: row.day as string,
      plannedHours: Number(row.hours ?? 0),
    });
  }

  if (autoCloseIds.length > 0) {
    await supabase.from("plan_items").update({ status: "done", updated_at: new Date().toISOString() }).in("id", autoCloseIds);
  }

  return { items, autoClosedCount: autoCloseIds.length, checkedDays: uncheckedDays };
}

export type MorningCheckSubmission = {
  blockId: string;
  source: "asana" | "personal";
  reference: string;
  outcome: MorningCheckOutcome;
  plannedHours: number;
  hoursLeft: number | null;
};

export async function submitMorningCheck(checkedDays: string[], outcomes: MorningCheckSubmission[]) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) throw new Error("Not signed in");

  for (const o of outcomes) {
    const update = resolveMorningCheckUpdate(o.outcome, o.plannedHours, o.hoursLeft);
    await supabase
      .from("plan_items")
      .update({
        status: update.status,
        actual_hours: update.actualHours,
        ...(update.clearPlacement ? { day: null, start_time: null, end_time: null, hours: null, pinned: false } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", o.blockId)
      .eq("user_id", user.id);

    if (update.remainingHours != null) {
      await supabase.from("task_meta").upsert({
        user_id: user.id,
        source: o.source,
        reference: o.reference,
        remaining_hours: update.remainingHours,
        updated_at: new Date().toISOString(),
      });
    }
  }

  for (const date of checkedDays) {
    const { data: existing } = await supabase
      .from("day_starts")
      .select("date")
      .eq("user_id", user.id)
      .eq("date", date)
      .maybeSingle();
    if (existing) {
      await supabase.from("day_starts").update({ morning_check_done: true }).eq("user_id", user.id).eq("date", date);
    } else {
      await supabase
        .from("day_starts")
        .insert({ user_id: user.id, date, start_time: "09:00", corrected: false, morning_check_done: true });
    }
  }

  revalidatePath("/");
}
