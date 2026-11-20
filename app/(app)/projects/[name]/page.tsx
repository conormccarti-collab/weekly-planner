import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { groupTasksByRoot, isInBacklog, type TaskRow } from "@/lib/asana/task-view";
import { preferredProjectName } from "@/lib/asana/projects";
import { mondayOf, utcInstantToLocal } from "@/lib/time";
import { env } from "@/lib/env";
import { ProjectNotes } from "@/components/project-notes";

export default async function ProjectDetailPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const projectName = decodeURIComponent(name);

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;

  if (!user) {
    return <h1 className="text-lg font-semibold">{projectName}</h1>;
  }

  const { data } = await supabase
    .from("asana_tasks")
    .select(
      "gid, name, parent_gid, parent_name, project_names, section_names, due_on, completed, custom_fields, permalink_url, assignee_name, is_container, is_plannable, is_shoot, no_longer_assigned"
    )
    .eq("completed", false)
    .eq("no_longer_assigned", false);

  const allTasks = (data as TaskRow[]) ?? [];
  const groups = groupTasksByRoot(allTasks)
    .filter((g) => !isInBacklog(g.root))
    .filter((g) => preferredProjectName(g.root.project_names) === projectName);

  const plannableTasks = groups.flatMap((g) => [g.root, ...g.descendants]).filter((t) => t.is_plannable);
  const gids = plannableTasks.map((t) => t.gid);

  const todayStr = utcInstantToLocal(new Date(), env.appTimezone()).dateStr;
  const weekStart = mondayOf(todayStr);

  let plannedHoursThisWeek = 0;
  if (gids.length > 0) {
    const { data: planRows } = await supabase
      .from("plan_items")
      .select("hours")
      .eq("user_id", user.id)
      .eq("week_start", weekStart)
      .eq("source", "asana")
      .in("reference", gids);
    plannedHoursThisWeek = (planRows ?? []).reduce((sum, r) => sum + Number(r.hours ?? 0), 0);
  }

  const { data: notesRow } = await supabase
    .from("project_notes")
    .select("notes")
    .eq("user_id", user.id)
    .eq("project_name", projectName)
    .maybeSingle();

  return (
    <div>
      <Link href="/projects" className="text-xs text-chalk-dim underline hover:text-chalk">
        ← Projects
      </Link>
      <h1 className="mt-1 text-lg font-semibold">{projectName}</h1>
      <p className="mt-1 text-sm text-chalk-dim">{plannedHoursThisWeek.toFixed(1)}h planned this week.</p>

      <h2 className="mt-4 text-sm font-semibold text-chalk">Tasks ({plannableTasks.length})</h2>
      <ul className="mt-2 divide-y divide-border">
        {plannableTasks.length === 0 && <p className="py-2 text-sm text-chalk-dim">No tasks.</p>}
        {plannableTasks
          .sort((a, b) => (a.due_on ?? "9999").localeCompare(b.due_on ?? "9999"))
          .map((task) => (
            <li key={task.gid} className="flex items-center justify-between gap-2 py-1.5 text-sm">
              <span>
                {task.name}
                {task.parent_name && <span className="ml-2 text-xs text-chalk-dim">in {task.parent_name}</span>}
              </span>
              {task.due_on && <span className="text-xs text-chalk-dim">due {task.due_on}</span>}
            </li>
          ))}
      </ul>

      <h2 className="mt-6 text-sm font-semibold text-chalk">Notes</h2>
      <div className="mt-2">
        <ProjectNotes projectName={projectName} initialNotes={(notesRow?.notes as string) ?? ""} />
      </div>
    </div>
  );
}
