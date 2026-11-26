import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { groupTasksByRoot, isInBacklog, type TaskRow } from "@/lib/asana/task-view";
import { partitionByEligibility } from "@/lib/asana/eligibility";
import { projectEntriesFor } from "@/lib/asana/projects";
import { loadSettings } from "@/lib/settings-data";
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
      "gid, name, parent_gid, parent_name, project_gids, project_names, section_names, due_on, completed, custom_fields, permalink_url, assignee_name, is_container, is_plannable, is_shoot, no_longer_assigned"
    )
    .eq("completed", false)
    .eq("no_longer_assigned", false);

  const allTasks = (data as TaskRow[]) ?? [];
  const settings = await loadSettings(supabase, user.id);
  const visibleGroups = groupTasksByRoot(allTasks).filter((g) => !isInBacklog(g.root));

  // v5 Stage 12d.2/12d.3: "Group the Projects page by project ID... no
  // combined names... Everything else assigned to Conor appears in a
  // collapsed 'Outside the workflow' list."
  const { eligible, outsideWorkflow } = partitionByEligibility(visibleGroups, settings.planned_project_gids);

  const countByProjectGid = new Map<string, { name: string; count: number }>();
  for (const group of eligible) {
    const entries = projectEntriesFor(group.root.project_gids, group.root.project_names);
    const plannableCount = [group.root, ...group.descendants].filter((t) => t.is_plannable).length;
    for (const { gid, name } of entries) {
      const existing = countByProjectGid.get(gid);
      countByProjectGid.set(gid, { name, count: (existing?.count ?? 0) + plannableCount });
    }
  }

  const projects = [...countByProjectGid.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  const { asana, calendar } = await loadSyncStatuses(supabase);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-lg font-semibold">Projects</h1>
      <p className="mt-1 text-sm text-chalk-dim">One page per project: its tasks, planned hours this week, and notes.</p>
      <div className="mt-3">
        <SyncBar asana={asana} calendar={calendar} />
      </div>
      <ul className="mt-4 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-slate">
        {projects.length === 0 && <p className="px-5 py-3 text-sm text-chalk-dim">No projects yet.</p>}
        {projects.map(([gid, { name, count }]) => (
          <li key={gid} className="flex items-center justify-between px-5 py-3 text-sm hover:bg-surface-hover">
            <Link href={`/projects/${gid}`} className="font-bold text-chalk">
              {name}
            </Link>
            <span className="text-xs text-chalk-dim">{count} task{count === 1 ? "" : "s"}</span>
          </li>
        ))}
      </ul>

      {outsideWorkflow.length > 0 && (
        <details className="mt-4 rounded-2xl border border-border bg-slate p-4 text-sm">
          <summary className="cursor-pointer font-medium text-chalk">
            Outside the workflow ({outsideWorkflow.length})
          </summary>
          <p className="mt-2 text-xs text-chalk-dim">
            Assigned to you, but not in a planned project (Settings → Planned projects). Other people&apos;s boards —
            never placed, never counted, never flagged. Read-only.
          </p>
          <ul className="mt-2 divide-y divide-border">
            {outsideWorkflow
              .map((g) => ({
                gid: g.root.gid,
                name: g.root.name,
                permalinkUrl: g.root.permalink_url,
                projects: projectEntriesFor(g.root.project_gids, g.root.project_names)
                  .map((e) => e.name)
                  .join(", ") || "No project",
              }))
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((t) => (
                <li key={t.gid} className="flex items-center justify-between py-1.5 text-xs">
                  {t.permalinkUrl ? (
                    <a href={t.permalinkUrl} target="_blank" rel="noreferrer" className="text-info underline">
                      {t.name}
                    </a>
                  ) : (
                    <span className="text-chalk">{t.name}</span>
                  )}
                  <span className="text-chalk-dim">{t.projects}</span>
                </li>
              ))}
          </ul>
        </details>
      )}
    </div>
  );
}
