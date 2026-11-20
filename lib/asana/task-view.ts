export type TaskRow = {
  gid: string;
  name: string;
  parent_gid: string | null;
  parent_name: string | null;
  project_names: string[];
  section_names: string[];
  due_on: string | null;
  start_on: string | null;
  completed: boolean;
  custom_fields: Record<string, string | null>;
  permalink_url: string | null;
  assignee_name: string | null;
  is_container: boolean;
  is_plannable: boolean;
  is_shoot: boolean;
  no_longer_assigned: boolean;
  blocked_by_gids: string[];
};

/** v1.3: Backlog is pre-active work and is hidden from planning by default. */
export function isInBacklog(task: TaskRow): boolean {
  return (task.section_names ?? []).some((s) => s.trim().toLowerCase() === "backlog");
}

export type TaskGroup = {
  root: TaskRow;
  /** All descendants of root (any depth), in no particular order. */
  descendants: TaskRow[];
};

/** Groups tasks by their top-level ancestor, so a container and its subtasks are shown together. */
export function groupTasksByRoot(tasks: TaskRow[]): TaskGroup[] {
  const byGid = new Map(tasks.map((t) => [t.gid, t]));

  function rootGidOf(gid: string): string {
    let current = byGid.get(gid);
    let rootGid = gid;
    const seen = new Set<string>();
    while (current?.parent_gid && byGid.has(current.parent_gid) && !seen.has(current.parent_gid)) {
      seen.add(current.parent_gid);
      rootGid = current.parent_gid;
      current = byGid.get(current.parent_gid);
    }
    return rootGid;
  }

  const groups = new Map<string, TaskGroup>();
  for (const task of tasks) {
    const rootGid = rootGidOf(task.gid);
    const root = byGid.get(rootGid)!;
    if (!groups.has(rootGid)) {
      groups.set(rootGid, { root, descendants: [] });
    }
    if (task.gid !== rootGid) {
      groups.get(rootGid)!.descendants.push(task);
    }
  }

  return Array.from(groups.values());
}

/** True when a container the user owns has no plannable work left (brief section 5). */
export function containerHasNothingToPlan(group: TaskGroup): boolean {
  return group.root.is_container && !group.descendants.some((t) => t.is_plannable);
}
