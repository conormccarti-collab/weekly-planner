import type { SupabaseClient } from "@supabase/supabase-js";
import type { Source } from "./resolve-drop";
import { addWorkingDays, daysBetweenDateStrs, type Weekday } from "./time";

/** How long an auto-guessed estimate sits before the morning brief asks you to confirm or correct it. */
export const UNCONFIRMED_ESTIMATE_NUDGE_DAYS = 2;

export type CheckoffReminder = { id: string; gid: string; name: string };
export type FollowUpReminder = {
  containerGid: string;
  containerName: string;
  subtaskGid: string;
  subtaskName: string;
  assigneeName: string | null;
  dueOn: string;
  isOverdue: boolean;
};
export type NewProjectReminder = { id: string; projectGid: string; projectName: string };
export type UnconfirmedEstimateReminder = {
  source: Source;
  reference: string;
  name: string;
  hours: number;
  stage: string | null;
  focusType: string | null;
  videoType: string | null;
};
export type RemindersData = {
  checkoffs: CheckoffReminder[];
  followUps: FollowUpReminder[];
  newProjects: NewProjectReminder[];
  unconfirmedEstimates: UnconfirmedEstimateReminder[];
};

/** Auto-resolve: nothing left to check off once the Asana task is completed, or gone. */
export function isCheckoffStillPending(task: { completed: boolean } | null | undefined): boolean {
  return task != null && !task.completed;
}

/** Auto-resolve: the nudge is satisfied once the project is added to Settings — no explicit retraction needed. */
export function isNewProjectReminderStillPending(projectGid: string, plannedProjectGids: string[]): boolean {
  return !plannedProjectGids.includes(projectGid);
}

/**
 * Auto-resolve: satisfied the moment the user confirms (or corrects) a real
 * estimate — `setTaskEstimate` always writes `estimate_origin: "user"`, so
 * there's nothing to retract here, same shape as the new-project reminder
 * above. The age check exists so a just-guessed estimate isn't immediately
 * nagged about — it only surfaces once it's had a couple of real days to
 * turn out wrong (the exact failure mode that produced tonight's Scott
 * Dunn mess: a 2.5h guess sat unconfirmed and silently capped a real 14h
 * task's placement).
 */
export function isEstimateStillUnconfirmed(estimateOrigin: string, updatedAtIso: string, todayStr: string): boolean {
  if (estimateOrigin !== "suggested") return false;
  const updatedDateStr = updatedAtIso.slice(0, 10);
  return daysBetweenDateStrs(updatedDateStr, todayStr) >= UNCONFIRMED_ESTIMATE_NUDGE_DAYS;
}

/** The most common value in the list, or undefined if it's empty. Ties keep whichever is seen first. */
export function mostFrequentValue(values: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | undefined;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Called after a plan block sourced from Asana is marked done in-app. A
 * no-op for personal tasks, which have no Asana counterpart to check off.
 * Re-upserting (done -> not done -> done again) clears a prior dismissal so
 * the reminder reappears.
 */
export async function createCheckoffReminder(
  supabase: SupabaseClient,
  userId: string,
  source: Source,
  reference: string
): Promise<void> {
  if (source !== "asana") return;
  await supabase
    .from("reminders")
    .upsert(
      { user_id: userId, kind: "asana_checkoff", reference, dismissed_at: null },
      { onConflict: "user_id,kind,reference" }
    );
}

/** Called when a done block is marked not-done again — retracts the reminder it created, if any. */
export async function retractCheckoffReminder(
  supabase: SupabaseClient,
  userId: string,
  source: Source,
  reference: string
): Promise<void> {
  if (source !== "asana") return;
  await supabase.from("reminders").delete().eq("user_id", userId).eq("kind", "asana_checkoff").eq("reference", reference);
}

export async function dismissReminderById(supabase: SupabaseClient, userId: string, id: string): Promise<void> {
  await supabase.from("reminders").update({ dismissed_at: new Date().toISOString() }).eq("id", id).eq("user_id", userId);
}

/**
 * Called from runAsanaSync when a project gid is new to asana_projects for
 * this user. A no-op is left to the caller (it should skip calling this at
 * all when the gid is already in settings.planned_project_gids) rather than
 * checked here, since sync.ts already has settings loaded at that point.
 * Re-upserting clears a prior dismissal, same as the checkoff reminder.
 */
export async function createNewProjectReminder(supabase: SupabaseClient, userId: string, projectGid: string): Promise<void> {
  await supabase
    .from("reminders")
    .upsert(
      { user_id: userId, kind: "new_outside_project", reference: projectGid, dismissed_at: null },
      { onConflict: "user_id,kind,reference" }
    );
}

/**
 * Read-time assembly for the Week page and chat context. Tolerant of
 * migration 0028 not being applied yet, same best-effort pattern as
 * lunch_overrides/day_locks/scheduling_rules (lib/calendar/week-capacity.ts):
 * a failed query leaves `data` null/empty and is treated as "nothing there."
 */
export async function loadReminders(
  supabase: SupabaseClient,
  userId: string,
  opts: { todayStr: string; workingDays: Weekday[]; plannedProjectGids: string[] }
): Promise<RemindersData> {
  const { data: pendingRows } = await supabase
    .from("reminders")
    .select("id, reference")
    .eq("user_id", userId)
    .eq("kind", "asana_checkoff")
    .is("dismissed_at", null);

  const checkoffs: CheckoffReminder[] = [];
  const rows = pendingRows ?? [];
  if (rows.length > 0) {
    const gids = rows.map((r) => r.reference as string);
    const { data: tasks } = await supabase.from("asana_tasks").select("gid, name, parent_name, completed").in("gid", gids);
    const taskByGid = new Map(
      (tasks ?? []).map((t) => [t.gid as string, t as { gid: string; name: string; parent_name: string | null; completed: boolean }])
    );
    for (const row of rows) {
      const task = taskByGid.get(row.reference as string);
      if (!isCheckoffStillPending(task)) continue;
      // A stage name like "Pre-Edit Review & Brief" is reused across every
      // deliverable — same "parentName — name" convention as entry-row.tsx.
      checkoffs.push({ id: row.id as string, gid: row.reference as string, name: task!.parent_name ? `${task!.parent_name} — ${task!.name}` : task!.name });
    }
  }

  const deadlineCutoff = addWorkingDays(opts.todayStr, 2, opts.workingDays);

  // Single-user app, but not every parent_gid-null row is "my" task — a
  // handful come from other paths (e.g. a blocker task cached by
  // lib/asana/dependencies.ts, assigned to whoever owns it). The large
  // majority genuinely are mine (fetched via `assignee: "me"` in
  // lib/asana/sync.ts), so the most frequent assignee_gid among them is a
  // reliable stand-in for "my" gid without a live Asana call or a stored
  // user-gid column.
  const { data: meRows } = await supabase.from("asana_tasks").select("assignee_gid").is("parent_gid", null).not("assignee_gid", "is", null);
  const meGid = mostFrequentValue((meRows ?? []).map((r) => r.assignee_gid as string));

  const followUps: FollowUpReminder[] = [];
  if (meGid) {
    const { data: containers } = await supabase.from("asana_tasks").select("gid, name").eq("is_container", true).eq("assignee_gid", meGid);
    const containerRows = containers ?? [];
    if (containerRows.length > 0) {
      const containerByGid = new Map(containerRows.map((c) => [c.gid as string, c.name as string]));
      const { data: subtasks } = await supabase
        .from("asana_tasks")
        .select("gid, name, parent_gid, assignee_name, due_on")
        .in("parent_gid", containerRows.map((c) => c.gid as string))
        .not("assignee_gid", "is", null)
        .neq("assignee_gid", meGid)
        .eq("completed", false)
        .not("due_on", "is", null)
        .lte("due_on", deadlineCutoff);
      for (const s of subtasks ?? []) {
        const containerGid = s.parent_gid as string;
        const containerName = containerByGid.get(containerGid);
        if (!containerName) continue;
        followUps.push({
          containerGid,
          containerName,
          subtaskGid: s.gid as string,
          subtaskName: s.name as string,
          assigneeName: (s.assignee_name as string | null) ?? null,
          dueOn: s.due_on as string,
          isOverdue: (s.due_on as string) < opts.todayStr,
        });
      }
    }
  }

  const { data: pendingProjectRows } = await supabase
    .from("reminders")
    .select("id, reference")
    .eq("user_id", userId)
    .eq("kind", "new_outside_project")
    .is("dismissed_at", null);

  const newProjects: NewProjectReminder[] = [];
  const projectRows = (pendingProjectRows ?? []).filter((r) => isNewProjectReminderStillPending(r.reference as string, opts.plannedProjectGids));
  if (projectRows.length > 0) {
    const { data: projects } = await supabase
      .from("asana_projects")
      .select("gid, name")
      .in(
        "gid",
        projectRows.map((r) => r.reference as string)
      );
    const nameByGid = new Map((projects ?? []).map((p) => [p.gid as string, p.name as string]));
    for (const row of projectRows) {
      const name = nameByGid.get(row.reference as string);
      if (!name) continue; // the project itself is gone — nothing left to decide
      newProjects.push({ id: row.id as string, projectGid: row.reference as string, projectName: name });
    }
  }

  // Only a suggested estimate still backing something actually on the
  // board right now is worth asking about — a guess sitting on long-term
  // backlog isn't urgent yet and would just be noise.
  const unconfirmedEstimates: UnconfirmedEstimateReminder[] = [];
  const { data: suggestedMeta } = await supabase
    .from("task_meta")
    .select("source, reference, estimate_hours, estimate_origin, updated_at, stage, focus_type, video_type")
    .eq("user_id", userId)
    .eq("estimate_origin", "suggested")
    .not("estimate_hours", "is", null);
  const stillUnconfirmed = (suggestedMeta ?? []).filter((m) =>
    isEstimateStillUnconfirmed(m.estimate_origin as string, m.updated_at as string, opts.todayStr)
  );
  if (stillUnconfirmed.length > 0) {
    const { data: activeRows } = await supabase
      .from("plan_items")
      .select("source, reference")
      .eq("user_id", userId)
      .in("status", ["planned", "suggested"]);
    const activeKeys = new Set((activeRows ?? []).map((r) => `${r.source}:${r.reference}`));
    const relevant = stillUnconfirmed.filter((m) => activeKeys.has(`${m.source}:${m.reference}`));
    const asanaGids = relevant.filter((m) => m.source === "asana").map((m) => m.reference as string);
    const personalIds = relevant.filter((m) => m.source === "personal").map((m) => m.reference as string);
    const [asanaNameRows, personalNameRows] = await Promise.all([
      asanaGids.length > 0 ? supabase.from("asana_tasks").select("gid, name, parent_name").in("gid", asanaGids) : Promise.resolve({ data: [] }),
      personalIds.length > 0 ? supabase.from("personal_tasks").select("id, name").in("id", personalIds) : Promise.resolve({ data: [] }),
    ]);
    const nameByKey = new Map<string, string>();
    for (const t of (asanaNameRows.data ?? []) as { gid: string; name: string; parent_name: string | null }[])
      nameByKey.set(`asana:${t.gid}`, t.parent_name ? `${t.parent_name} — ${t.name}` : t.name);
    for (const t of (personalNameRows.data ?? []) as { id: string; name: string }[]) nameByKey.set(`personal:${t.id}`, t.name);
    for (const m of relevant) {
      const name = nameByKey.get(`${m.source}:${m.reference}`);
      if (!name) continue; // task itself is gone — nothing left to confirm
      unconfirmedEstimates.push({
        source: m.source as Source,
        reference: m.reference as string,
        name,
        hours: Number(m.estimate_hours),
        stage: (m.stage as string | null) ?? null,
        focusType: (m.focus_type as string | null) ?? null,
        videoType: (m.video_type as string | null) ?? null,
      });
    }
  }

  return { checkoffs, followUps, newProjects, unconfirmedEstimates };
}
