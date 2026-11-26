import type { SupabaseClient } from "@supabase/supabase-js";
import type { Source } from "./resolve-drop";
import { addWorkingDays, type Weekday } from "./time";

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
export type RemindersData = { checkoffs: CheckoffReminder[]; followUps: FollowUpReminder[]; newProjects: NewProjectReminder[] };

/** Auto-resolve: nothing left to check off once the Asana task is completed, or gone. */
export function isCheckoffStillPending(task: { completed: boolean } | null | undefined): boolean {
  return task != null && !task.completed;
}

/** Auto-resolve: the nudge is satisfied once the project is added to Settings — no explicit retraction needed. */
export function isNewProjectReminderStillPending(projectGid: string, plannedProjectGids: string[]): boolean {
  return !plannedProjectGids.includes(projectGid);
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
    const { data: tasks } = await supabase.from("asana_tasks").select("gid, name, completed").in("gid", gids);
    const taskByGid = new Map((tasks ?? []).map((t) => [t.gid as string, t as { gid: string; name: string; completed: boolean }]));
    for (const row of rows) {
      const task = taskByGid.get(row.reference as string);
      if (!isCheckoffStillPending(task)) continue;
      checkoffs.push({ id: row.id as string, gid: row.reference as string, name: task!.name });
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

  return { checkoffs, followUps, newProjects };
}
