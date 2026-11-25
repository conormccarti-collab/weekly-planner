"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Weekday } from "@/lib/time";

export async function setDayStart(date: string, startTime: string) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) {
    throw new Error("Not signed in");
  }

  const { error } = await supabase.from("day_starts").upsert({
    user_id: user.id,
    date,
    start_time: startTime,
    corrected: true,
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/");
}

/**
 * Week-list rebuild: the day card's inline lunch-time field, editable per
 * weekday right where it's used (not just in Settings). `lunch_times` is
 * stored as one whole object per user, not a column per weekday, so this is
 * a read-modify-write of just the one key — every other weekday's time is
 * left untouched. A true per-date override (today's lunch differs from
 * every other Tuesday) is a separate, larger piece of work, not this.
 */
export async function setLunchTimeForWeekday(weekday: Weekday, time: string) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) {
    throw new Error("Not signed in");
  }

  const { data } = await supabase.from("settings").select("lunch_times").eq("user_id", user.id).maybeSingle();
  const lunchTimes = { ...((data?.lunch_times as Record<string, string>) ?? {}), [weekday]: time };

  const { error } = await supabase
    .from("settings")
    .update({ lunch_times: lunchTimes, updated_at: new Date().toISOString() })
    .eq("user_id", user.id);
  if (error) throw new Error(error.message);

  revalidatePath("/");
}

/**
 * The true per-date override day-card's lunch editor now uses (mirrors
 * setDayStart/day_starts exactly). Independent of setLunchTimeForWeekday
 * above: this sets just one date, not the recurring weekday default.
 */
export async function setLunchOverride(date: string, time: string) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) {
    throw new Error("Not signed in");
  }

  const { error } = await supabase.from("lunch_overrides").upsert({
    user_id: user.id,
    date,
    lunch_start_time: time,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/");
}

/**
 * Marks (or clears) a single date as unavailable — excluded from
 * auto-placement entirely (see getWeekCapacity, which forces isWorkingDay
 * false for a locked date). Never force-moves anything already placed
 * there — that's what Re-prioritise is for.
 */
export async function setDayLock(date: string, locked: boolean, reason?: string) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) {
    throw new Error("Not signed in");
  }

  if (locked) {
    const { error } = await supabase.from("day_locks").upsert({ user_id: user.id, date, reason: reason ?? null });
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from("day_locks").delete().eq("user_id", user.id).eq("date", date);
    if (error) throw new Error(error.message);
  }

  revalidatePath("/");
}
