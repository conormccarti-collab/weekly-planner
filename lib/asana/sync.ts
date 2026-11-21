import type { SupabaseClient } from "@supabase/supabase-js";
import { getMe, getTask, listProjectTasks, listSubtasks, listTasksAssignedToMe } from "./client";
import { classifyTask } from "./classify";
import { detectStage } from "./stage";
import { PRODUCTION_SHOOTS_PROJECT_GID } from "./projects";
import type { AsanaTask } from "./types";
import { env } from "@/lib/env";

const MAX_SUBTASK_DEPTH = 3;
const COMPLETED_LOOKBACK_DAYS = 14;

type StoredTask = {
  gid: string;
  name: string;
  parent_gid: string | null;
  parent_name: string | null;
  project_gids: string[];
  project_names: string[];
  section_names: string[];
  due_on: string | null;
  start_on: string | null;
  completed: boolean;
  completed_at: string | null;
  custom_fields: Record<string, string | null>;
  subtask_count: number;
  permalink_url: string | null;
  assignee_gid: string | null;
  assignee_name: string | null;
  is_container: boolean;
  is_plannable: boolean;
  is_shoot: boolean;
  blocked_by_gids: string[];
  asana_modified_at: string | null;
};

function customFieldsToMap(task: AsanaTask): Record<string, string | null> {
  const map: Record<string, string | null> = {};
  for (const field of task.custom_fields ?? []) {
    // v1.3: match by name, trimmed — the "Paid " option has a trailing space.
    const value = field.display_value?.trim() ?? null;
    if (!(field.name in map) || map[field.name] == null) {
      map[field.name] = value;
    }
  }
  return map;
}

function blockedByGidsOf(task: AsanaTask): string[] {
  return (task.dependencies ?? []).map((d) => d.gid);
}

/**
 * v5 Stage 12e.4 fix: the real bug behind "Brand/Video Type inheritance
 * is broken" — `customFieldsToMap` always has an entry for every workspace
 * custom field on every task, Asana included, even when it's unset
 * (`display_value: null`). A plain object spread `{...parent, ...own}`
 * can't tell "own doesn't have this field" from "own has it, explicitly
 * unset" - the second case always overwrites the parent's real value with
 * null. This merges per-key instead: the child's own value wins only when
 * it's actually set.
 */
export function mergeCustomFields(
  parent: Record<string, string | null>,
  own: Record<string, string | null>
): Record<string, string | null> {
  const merged = { ...parent };
  for (const [key, value] of Object.entries(own)) {
    if (value != null) merged[key] = value;
  }
  return merged;
}

function projectsAndSections(task: AsanaTask): {
  projectGids: string[];
  projectNames: string[];
  sectionNames: string[];
} {
  const projectGids = (task.projects ?? []).map((p) => p.gid);
  const projectNames = (task.projects ?? []).map((p) => p.name);
  const sectionNames = (task.memberships ?? [])
    .map((m) => m.section?.name)
    .filter((n): n is string => !!n);
  return { projectGids, projectNames, sectionNames };
}

/** Container assigned to the user: fetch subtasks up to MAX_SUBTASK_DEPTH, classifying each. */
async function collectSubtasksRecursively(
  containerGid: string,
  meGid: string,
  depth: number,
  tasksByGid: Map<string, StoredTask>,
  assignedGids: Set<string>,
  parentCustomFields: Record<string, string | null>
): Promise<void> {
  if (depth > MAX_SUBTASK_DEPTH) return;

  const subtasks = await listSubtasks(containerGid);
  for (const subtask of subtasks) {
    const assigneeGid = subtask.assignee?.gid ?? null;
    if (assigneeGid === meGid) assignedGids.add(subtask.gid);

    const detectedStage = detectStage(subtask.name);
    const { isContainer, isPlannable } = classifyTask(subtask.num_subtasks ?? 0, assigneeGid, meGid, detectedStage);

    const { projectGids, projectNames, sectionNames } = projectsAndSections(subtask);

    // Brief section 5: "Subtasks do not carry [custom fields] themselves" —
    // inherit Content Type, Brand, etc. from the parent, letting the
    // subtask's own value (if ever set) take precedence.
    const customFields = mergeCustomFields(parentCustomFields, customFieldsToMap(subtask));

    tasksByGid.set(subtask.gid, {
      gid: subtask.gid,
      name: subtask.name,
      parent_gid: subtask.parent?.gid ?? containerGid,
      parent_name: subtask.parent?.name ?? null,
      project_gids: projectGids,
      project_names: projectNames,
      section_names: sectionNames,
      due_on: subtask.due_on,
      start_on: subtask.start_on,
      completed: subtask.completed,
      completed_at: subtask.completed_at,
      custom_fields: customFields,
      subtask_count: subtask.num_subtasks ?? 0,
      permalink_url: subtask.permalink_url,
      assignee_gid: assigneeGid,
      assignee_name: subtask.assignee?.name ?? null,
      is_container: isContainer,
      is_plannable: isPlannable,
      is_shoot: detectedStage === "Shoot",
      blocked_by_gids: blockedByGidsOf(subtask),
      asana_modified_at: subtask.modified_at,
    });

    if (isContainer) {
      await collectSubtasksRecursively(subtask.gid, meGid, depth + 1, tasksByGid, assignedGids, customFields);
    }
  }
}

/**
 * Walk up the parent chain (up to 3 levels) to find project/section info
 * and custom fields (Brand, Video Type, ...) a subtask doesn't carry
 * itself. Reuses an already-fetched ancestor from `tasksByGid` (e.g. one
 * `collectSubtasksRecursively` already stored) instead of refetching it —
 * this runs for every directly-assigned subtask with a parent, so without
 * the cache check it would double the Asana API calls for a task tree
 * that's already been walked the other way.
 *
 * v5 Stage 12e.4 fix: a subtask reached via `directTasks` (because it's
 * *also* individually assigned to the user, not only discovered through
 * its container) used to get only its own custom fields here — never
 * merged with the parent's — so Brand/Video Type silently came back blank
 * for exactly that case, even though `collectSubtasksRecursively`'s own
 * merge was already correct for a purely-recursively-discovered subtask.
 */
async function resolveAncestorContext(
  task: AsanaTask,
  tasksByGid: Map<string, StoredTask>
): Promise<{ projectGids: string[]; projectNames: string[]; sectionNames: string[]; customFields: Record<string, string | null> }> {
  let parentRef = task.parent;
  let immediateParentCustomFields: Record<string, string | null> | null = null;

  for (let i = 0; i < MAX_SUBTASK_DEPTH && parentRef; i++) {
    const cached = tasksByGid.get(parentRef.gid);
    if (cached) {
      if (immediateParentCustomFields == null) immediateParentCustomFields = cached.custom_fields;
      if (cached.project_gids.length > 0) {
        return {
          projectGids: cached.project_gids,
          projectNames: cached.project_names,
          sectionNames: cached.section_names,
          customFields: immediateParentCustomFields,
        };
      }
      parentRef = cached.parent_gid ? { gid: cached.parent_gid, name: cached.parent_name ?? "" } : null;
      continue;
    }

    const parent = await getTask(parentRef.gid);
    const { projectGids, projectNames, sectionNames } = projectsAndSections(parent);
    const parentCustomFields = customFieldsToMap(parent);
    if (immediateParentCustomFields == null) immediateParentCustomFields = parentCustomFields;

    tasksByGid.set(parent.gid, {
      gid: parent.gid,
      name: parent.name,
      parent_gid: parent.parent?.gid ?? null,
      parent_name: parent.parent?.name ?? null,
      project_gids: projectGids,
      project_names: projectNames,
      section_names: sectionNames,
      due_on: parent.due_on,
      start_on: parent.start_on,
      completed: parent.completed,
      completed_at: parent.completed_at,
      custom_fields: parentCustomFields,
      subtask_count: parent.num_subtasks ?? 0,
      permalink_url: parent.permalink_url,
      assignee_gid: parent.assignee?.gid ?? null,
      assignee_name: parent.assignee?.name ?? null,
      is_container: (parent.num_subtasks ?? 0) > 0,
      is_plannable: false,
      is_shoot: false,
      blocked_by_gids: blockedByGidsOf(parent),
      asana_modified_at: parent.modified_at,
    });

    if (projectGids.length > 0) {
      return { projectGids, projectNames, sectionNames, customFields: immediateParentCustomFields };
    }
    parentRef = parent.parent;
  }
  return { projectGids: [], projectNames: [], sectionNames: [], customFields: immediateParentCustomFields ?? {} };
}

export async function runAsanaSync(supabase: SupabaseClient, userId: string) {
  const startedAt = new Date().toISOString();

  try {
    const me = await getMe();
    const workspaceGid = env.asanaWorkspaceGid();
    const completedSince = new Date(
      Date.now() - COMPLETED_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();

    const directTasks = await listTasksAssignedToMe(workspaceGid, completedSince);

    const tasksByGid = new Map<string, StoredTask>();
    const assignedGids = new Set<string>();

    for (const task of directTasks) {
      assignedGids.add(task.gid);
      const isContainer = (task.num_subtasks ?? 0) > 0;
      let { projectGids, projectNames, sectionNames } = projectsAndSections(task);
      let ancestorCustomFields: Record<string, string | null> = {};

      // v5 Stage 12e.4 fix: resolve ancestor context (for the custom-field
      // merge below) whenever this task has a parent at all — not only
      // when it's missing its own project, which used to skip the Brand/
      // Video Type inheritance entirely for a subtask that's in a project
      // directly but still carries no custom fields of its own.
      if (task.parent) {
        const ancestorContext = await resolveAncestorContext(task, tasksByGid);
        ancestorCustomFields = ancestorContext.customFields;
        if (projectGids.length === 0) {
          projectGids = ancestorContext.projectGids;
          projectNames = ancestorContext.projectNames;
          sectionNames = ancestorContext.sectionNames;
        }
      }

      // Brief section 5: "Subtasks do not carry [custom fields] themselves"
      // — inherit Brand, Video Type etc. from the parent, letting the
      // task's own value (if ever set) take precedence. Same merge
      // `collectSubtasksRecursively` already does for a subtask discovered
      // only through its container.
      const taskCustomFields = mergeCustomFields(ancestorCustomFields, customFieldsToMap(task));

      tasksByGid.set(task.gid, {
        gid: task.gid,
        name: task.name,
        parent_gid: task.parent?.gid ?? null,
        parent_name: task.parent?.name ?? null,
        project_gids: projectGids,
        project_names: projectNames,
        section_names: sectionNames,
        due_on: task.due_on,
        start_on: task.start_on,
        completed: task.completed,
        completed_at: task.completed_at,
        custom_fields: taskCustomFields,
        subtask_count: task.num_subtasks ?? 0,
        permalink_url: task.permalink_url,
        assignee_gid: task.assignee?.gid ?? me.gid,
        assignee_name: task.assignee?.name ?? me.name,
        // A container is never planned itself — its plannable subtasks are fetched below.
        is_container: isContainer,
        is_plannable: !isContainer,
        is_shoot: !isContainer && detectStage(task.name) === "Shoot",
        blocked_by_gids: blockedByGidsOf(task),
        asana_modified_at: task.modified_at,
      });

      if (isContainer) {
        await collectSubtasksRecursively(task.gid, me.gid, 1, tasksByGid, assignedGids, taskCustomFields);
      }
    }

    // v1.3: shoots now also live as their own tasks in Production & Shoots,
    // not assigned to the user — read that project directly and mark them.
    // Scheduling against them (never placing work before the shoot is done)
    // is Stage 5's job once placement exists; this just captures the data.
    const shootTasks = await listProjectTasks(PRODUCTION_SHOOTS_PROJECT_GID, completedSince);
    for (const shootTask of shootTasks) {
      if (tasksByGid.has(shootTask.gid)) continue;
      const { projectGids, projectNames, sectionNames } = projectsAndSections(shootTask);
      tasksByGid.set(shootTask.gid, {
        gid: shootTask.gid,
        name: shootTask.name,
        parent_gid: shootTask.parent?.gid ?? null,
        parent_name: shootTask.parent?.name ?? null,
        project_gids: projectGids,
        project_names: projectNames,
        section_names: sectionNames,
        due_on: shootTask.due_on,
        start_on: shootTask.start_on,
        completed: shootTask.completed,
        completed_at: shootTask.completed_at,
        custom_fields: customFieldsToMap(shootTask),
        subtask_count: shootTask.num_subtasks ?? 0,
        permalink_url: shootTask.permalink_url,
        assignee_gid: shootTask.assignee?.gid ?? null,
        assignee_name: shootTask.assignee?.name ?? null,
        is_container: false,
        is_plannable: false,
        is_shoot: true,
        blocked_by_gids: blockedByGidsOf(shootTask),
        asana_modified_at: shootTask.modified_at,
      });
    }

    const rows = Array.from(tasksByGid.values()).map((t) => ({
      ...t,
      user_id: userId,
      last_synced_at: new Date().toISOString(),
    }));

    if (rows.length > 0) {
      const { error: upsertError } = await supabase.from("asana_tasks").upsert(rows);
      if (upsertError) throw new Error(upsertError.message);
    }

    const projectRows = new Map<string, { gid: string; name: string }>();
    for (const t of tasksByGid.values()) {
      t.project_gids.forEach((gid, i) => projectRows.set(gid, { gid, name: t.project_names[i] }));
    }
    if (projectRows.size > 0) {
      const { error: projectError } = await supabase.from("asana_projects").upsert(
        Array.from(projectRows.values()).map((p) => ({
          gid: p.gid,
          name: p.name,
          user_id: userId,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: "gid", ignoreDuplicates: false }
      );
      if (projectError) throw new Error(projectError.message);
    }

    if (assignedGids.size > 0) {
      const { error: staleError } = await supabase
        .from("asana_tasks")
        .update({ no_longer_assigned: true })
        .eq("user_id", userId)
        .eq("no_longer_assigned", false)
        .not("assignee_gid", "is", null)
        .eq("assignee_gid", me.gid)
        .not("gid", "in", `(${Array.from(assignedGids).join(",")})`);
      if (staleError) throw new Error(staleError.message);
    }

    await supabase.from("sync_log").insert({
      user_id: userId,
      source: "asana",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      ok: true,
    });

    return { ok: true as const, taskCount: rows.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown sync error";
    await supabase.from("sync_log").insert({
      user_id: userId,
      source: "asana",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      ok: false,
      error: message,
    });
    return { ok: false as const, error: message };
  }
}
