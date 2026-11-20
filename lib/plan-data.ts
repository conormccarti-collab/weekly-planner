import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysToDateStr, parseHHMM } from "@/lib/time";

export type PlacedItem = {
  id: string;
  source: "asana" | "personal";
  reference: string;
  day: string;
  startMinutes: number;
  endMinutes: number;
  hours: number;
  actualHours: number | null;
  must: boolean;
  status: string;
  pinned: boolean;
};

export type UnplacedRef = { source: "asana" | "personal"; reference: string; must: boolean };

export type WeekPlanData = {
  weekStart: string;
  weekEndExclusive: string;
  status: "draft" | "saved";
  placed: PlacedItem[];
  unplaced: UnplacedRef[];
  /** Release 1.1: tasks the over-capacity proposal moved out of this week — excluded from both lists above, and from live due-date re-inclusion. */
  movedAwayRefs: Set<string>;
};

/**
 * Creates the week's row on first visit, and brings forward anything left
 * unfinished from last week's saved plan (brief section 8, "this week"
 * criterion: "was left unfinished in last week's saved plan").
 */
export async function ensureWeekInitialized(
  supabase: SupabaseClient,
  userId: string,
  weekStart: string
): Promise<void> {
  const { data: existing } = await supabase
    .from("weeks")
    .select("week_start")
    .eq("user_id", userId)
    .eq("week_start", weekStart)
    .maybeSingle();

  if (existing) return;

  await supabase.from("weeks").insert({ user_id: userId, week_start: weekStart, status: "draft" });

  const lastWeekStart = addDaysToDateStr(weekStart, -7);
  const { data: lastWeek } = await supabase
    .from("weeks")
    .select("status")
    .eq("user_id", userId)
    .eq("week_start", lastWeekStart)
    .maybeSingle();

  if (lastWeek?.status !== "saved") return;

  const { data: unfinished } = await supabase
    .from("plan_items")
    .select("source, reference, must")
    .eq("user_id", userId)
    .eq("week_start", lastWeekStart)
    .in("status", ["planned", "behind"]);

  if (!unfinished || unfinished.length === 0) return;

  await supabase.from("plan_items").insert(
    unfinished.map((item) => ({
      user_id: userId,
      week_start: weekStart,
      source: item.source,
      reference: item.reference,
      must: item.must,
      day: null,
      hours: null,
      status: "planned",
    }))
  );
}

export async function loadWeekPlan(
  supabase: SupabaseClient,
  userId: string,
  weekStart: string
): Promise<WeekPlanData> {
  const weekEndExclusive = addDaysToDateStr(weekStart, 7);

  const [weekResult, itemsResult] = await Promise.all([
    supabase.from("weeks").select("status").eq("user_id", userId).eq("week_start", weekStart).maybeSingle(),
    supabase
      .from("plan_items")
      .select("id, source, reference, must, day, hours, actual_hours, status, start_time, end_time, pinned")
      .eq("user_id", userId)
      .eq("week_start", weekStart),
  ]);

  const status = (weekResult.data?.status as "draft" | "saved" | undefined) ?? "draft";
  const allRows = itemsResult.data ?? [];
  const movedAwayRefs = new Set(allRows.filter((r) => r.status === "moved").map((r) => `${r.source}:${r.reference}`));
  const rows = allRows.filter((r) => r.status !== "moved");

  const placed: PlacedItem[] = rows
    .filter((r) => r.day != null)
    .map((r) => {
      const hours = Number(r.hours ?? 0);
      const startMinutes = r.start_time ? parseHHMM(r.start_time as string) : 9 * 60;
      const endMinutes = r.end_time ? parseHHMM(r.end_time as string) : startMinutes + Math.round(hours * 60);
      return {
        id: r.id as string,
        source: r.source as "asana" | "personal",
        reference: r.reference as string,
        day: r.day as string,
        startMinutes,
        endMinutes,
        hours,
        actualHours: r.actual_hours == null ? null : Number(r.actual_hours),
        must: r.must as boolean,
        status: r.status as string,
        pinned: (r.pinned as boolean | null) ?? false,
      };
    });

  const unplaced: UnplacedRef[] = rows
    .filter((r) => r.day == null)
    .map((r) => ({ source: r.source as "asana" | "personal", reference: r.reference as string, must: r.must as boolean }));

  return { weekStart, weekEndExclusive, status, placed, unplaced, movedAwayRefs };
}
