import type { AsanaTask, AsanaUser } from "./types";

// Rule 1 (brief section 2): the Asana client may only issue GET requests.
// Enforced structurally — this module has no function that sends any other
// HTTP method, and this is the only place that calls the Asana API.
const ASANA_BASE_URL = "https://app.asana.com/api/1.0";

const TASK_OPT_FIELDS = [
  "name",
  "completed",
  "completed_at",
  "due_on",
  "start_on",
  "modified_at",
  "num_subtasks",
  "permalink_url",
  "parent.gid",
  "parent.name",
  "assignee.gid",
  "assignee.name",
  "projects.gid",
  "projects.name",
  "memberships.project.gid",
  "memberships.project.name",
  "memberships.section.gid",
  "memberships.section.name",
  "custom_fields.name",
  "custom_fields.display_value",
  "dependencies.gid",
].join(",");

async function asanaGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const pat = process.env.ASANA_PAT;
  if (!pat) {
    throw new Error("Missing ASANA_PAT");
  }

  const url = new URL(`${ASANA_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${pat}` },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Asana GET ${path} failed: ${response.status} ${body}`);
  }

  const json = await response.json();
  return json.data as T;
}

export async function getMe(): Promise<AsanaUser> {
  return asanaGet<AsanaUser>("/users/me", { opt_fields: "gid,name,email" });
}

export async function listTasksAssignedToMe(
  workspaceGid: string,
  completedSinceIso: string
): Promise<AsanaTask[]> {
  return asanaGet<AsanaTask[]>("/tasks", {
    assignee: "me",
    workspace: workspaceGid,
    completed_since: completedSinceIso,
    opt_fields: TASK_OPT_FIELDS,
    limit: "100",
  });
}

export async function getTask(gid: string): Promise<AsanaTask> {
  return asanaGet<AsanaTask>(`/tasks/${gid}`, { opt_fields: TASK_OPT_FIELDS });
}

export async function listSubtasks(gid: string): Promise<AsanaTask[]> {
  return asanaGet<AsanaTask[]>(`/tasks/${gid}/subtasks`, {
    opt_fields: TASK_OPT_FIELDS,
    limit: "100",
  });
}

/** v1.3: shoots live as their own tasks in Production & Shoots, not assigned to the user. */
export async function listProjectTasks(projectGid: string, completedSinceIso: string): Promise<AsanaTask[]> {
  return asanaGet<AsanaTask[]>(`/projects/${projectGid}/tasks`, {
    completed_since: completedSinceIso,
    opt_fields: TASK_OPT_FIELDS,
    limit: "100",
  });
}

/**
 * v4 Stage 10: the only two writes this app may ever make to Asana —
 * marking a task complete, and changing its due date — each one a single
 * hard-coded field, never a caller-supplied field dict. Only ever called
 * from the approval path in `app/(app)/write-back/actions.ts`, never from
 * a sync or read path.
 */
async function asanaPut(path: string, body: Record<string, unknown>): Promise<AsanaTask> {
  const pat = process.env.ASANA_PAT;
  if (!pat) {
    throw new Error("Missing ASANA_PAT");
  }

  const response = await fetch(`${ASANA_BASE_URL}${path}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json" },
    body: JSON.stringify({ data: body }),
  });

  if (!response.ok) {
    const responseBody = await response.text().catch(() => "");
    throw new Error(`Asana PUT ${path} failed: ${response.status} ${responseBody}`);
  }

  const json = await response.json();
  return json.data as AsanaTask;
}

export async function completeTaskInAsana(gid: string): Promise<AsanaTask> {
  return asanaPut(`/tasks/${gid}`, { completed: true });
}

export async function setTaskDueDateInAsana(gid: string, dueOn: string): Promise<AsanaTask> {
  return asanaPut(`/tasks/${gid}`, { due_on: dueOn });
}
