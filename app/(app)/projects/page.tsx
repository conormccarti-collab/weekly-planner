import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { groupTasksByRoot, isInBacklog, type TaskRow } from "@/lib/asana/task-view";
import { projectLabelsFor } from "@/lib/asana/projects";
import { loadSyncStatuses } from "@/lib/sync-status";
import { SyncBar } from "@/components/sync-bar";

export default async function ProjectsPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;

  if (!user) {
    return <h1 className="text-lg font-semibold">Projects</h1>;
  }

  const { data } = await supabase
    .from("asana_tasks")
    .select(
      "gid, name, parent_gid, parent_name, project_names, section_names, due_on, completed, custom_fields, permalink_url, assignee_name, is_container, is_plannable, is_shoot, no_longer_assigned"
    )
    .eq("completed", false)
    .eq("no_longer_assigned", false);

  const allTasks = (data as TaskRow[]) ?? [];
  const visibleGroups = groupTasksByRoot(allTasks).filter((g) => !isInBacklog(g.root));

  // v4: a task counts under every real project it's actually in — never a
  // joined "A, B" label, which used to invent a phantom third "project"
  // and steal its tasks away from both A and B's own entries.
  const countByProject = new Map<string, number>();
  for (const group of visibleGroups) {
    const labels = projectLabelsFor(group.root.project_names);
    if (labels.length === 0) continue;
    const plannableCount = [group.root, ...group.descendants].filter((t) => t.is_plannable).length;
    for (const label of labels) {
      countByProject.set(label, (countByProject.get(label) ?? 0) + plannableCount);
    }
  }

  const projects = [...countByProject.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const { asana, calendar } = await loadSyncStatuses(supabase);

  return (
    <div>
      <h1 className="text-lg font-semibold">Projects</h1>
      <p className="mt-1 text-sm text-chalk-dim">One page per project: its tasks, planned hours this week, and notes.</p>
      <div className="mt-3">
        <SyncBar asana={asana} calendar={calendar} />
      </div>
      <ul className="mt-4 divide-y divide-border">
        {projects.length === 0 && <p className="py-2 text-sm text-chalk-dim">No projects yet.</p>}
        {projects.map(([name, count]) => (
          <li key={name} className="flex items-center justify-between py-2 text-sm">
            <Link href={`/projects/${encodeURIComponent(name)}`} className="text-info underline">
              {name}
            </Link>
            <span className="text-xs text-chalk-dim">{count} task{count === 1 ? "" : "s"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
