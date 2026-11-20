import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { groupTasksByRoot, isInBacklog, type TaskRow } from "@/lib/asana/task-view";
import { preferredProjectName } from "@/lib/asana/projects";

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

  const countByProject = new Map<string, number>();
  for (const group of visibleGroups) {
    const label = preferredProjectName(group.root.project_names);
    if (!label) continue;
    const plannableCount = [group.root, ...group.descendants].filter((t) => t.is_plannable).length;
    countByProject.set(label, (countByProject.get(label) ?? 0) + plannableCount);
  }

  const projects = [...countByProject.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <div>
      <h1 className="text-lg font-semibold">Projects</h1>
      <p className="mt-1 text-sm text-chalk-dim">One page per project: its tasks, planned hours this week, and notes.</p>
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
