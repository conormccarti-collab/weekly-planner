import { createClient } from "@/lib/supabase/server";
import { groupTasksByRoot, isInBacklog, type TaskRow } from "@/lib/asana/task-view";
import { checkBrand, checkColumnMatchesStage, checkGroupDates, checkVideoType, type HygieneFlag } from "@/lib/hygiene";
import { env } from "@/lib/env";
import { addDaysToDateStr, mondayOf, utcInstantToLocal } from "@/lib/time";
import { loadSyncStatuses } from "@/lib/sync-status";
import { SyncBar } from "@/components/sync-bar";

export default async function HygienePage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;

  if (!user) {
    return <h1 className="text-lg font-semibold">Hygiene</h1>;
  }

  const { data } = await supabase
    .from("asana_tasks")
    .select(
      "gid, name, parent_gid, parent_name, project_names, section_names, due_on, start_on, completed, custom_fields, permalink_url, assignee_name, is_container, is_plannable, is_shoot, no_longer_assigned"
    )
    .eq("completed", false)
    .eq("no_longer_assigned", false);

  const allTasks = (data as TaskRow[]) ?? [];
  const visibleGroups = groupTasksByRoot(allTasks).filter((g) => !isInBacklog(g.root));

  // v2 (18 Nov 2026): hygiene only ever flags the parent deliverable, never
  // a subtask on its own row — Brand/Video Type/column checks run on the
  // root only; checkGroupDates already attributes its findings to the root.
  const flags: HygieneFlag[] = [];
  for (const group of visibleGroups) {
    flags.push(...checkGroupDates(group));
    flags.push(...checkColumnMatchesStage(group));
    flags.push(...checkBrand(group.root));
    flags.push(...checkVideoType(group.root));
  }

  const byTask = new Map<string, { name: string; permalinkUrl: string | null; dueOn: string | null; issues: string[] }>();
  const dueOnByGid = new Map(visibleGroups.map((g) => [g.root.gid, g.root.due_on]));
  for (const f of flags) {
    const entry = byTask.get(f.gid) ?? { name: f.name, permalinkUrl: f.permalinkUrl, dueOn: dueOnByGid.get(f.gid) ?? null, issues: [] };
    entry.issues.push(f.issue);
    byTask.set(f.gid, entry);
  }

  // Due this week or overdue first, then upcoming-dated, soonest first in
  // each group; undated tasks last, alphabetically.
  const todayStr = utcInstantToLocal(new Date(), env.appTimezone()).dateStr;
  const thisWeekEnd = addDaysToDateStr(mondayOf(todayStr), 7); // exclusive
  function dateTier(dueOn: string | null): number {
    if (dueOn == null) return 2;
    return dueOn < thisWeekEnd ? 0 : 1;
  }
  const rows = [...byTask.entries()].sort((a, b) => {
    const tierDiff = dateTier(a[1].dueOn) - dateTier(b[1].dueOn);
    if (tierDiff !== 0) return tierDiff;
    if (a[1].dueOn !== b[1].dueOn) return (a[1].dueOn ?? "9999-99-99").localeCompare(b[1].dueOn ?? "9999-99-99");
    return a[1].name.localeCompare(b[1].name);
  });
  const { asana, calendar } = await loadSyncStatuses(supabase);

  return (
    <div>
      <h1 className="text-lg font-semibold">Hygiene</h1>
      <p className="mt-1 text-sm text-chalk-dim">
        Data issues on parent deliverables only (not completed, not Backlog, not individual subtasks). Covers
        Brand, Video Type, missing dates, and a card sitting in the wrong column for its earliest unfinished
        stage. Due this week or overdue first, then upcoming-dated, then undated.
      </p>
      <div className="mt-3">
        <SyncBar asana={asana} calendar={calendar} />
      </div>

      <p className="mt-3 text-sm text-chalk">
        {rows.length === 0 ? "No issues found." : `${rows.length} task${rows.length === 1 ? "" : "s"} flagged.`}
      </p>

      <ul className="mt-2 divide-y divide-border">
        {rows.map(([gid, row]) => (
          <li key={gid} className="py-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              {row.permalinkUrl ? (
                <a href={row.permalinkUrl} target="_blank" rel="noreferrer" className="font-medium text-info underline">
                  {row.name}
                </a>
              ) : (
                <span className="font-medium text-chalk">{row.name}</span>
              )}
              {row.dueOn && <span className="text-xs text-chalk-dim">due {row.dueOn}</span>}
            </div>
            <ul className="mt-1 list-inside list-disc text-xs text-chalk-dim">
              {row.issues.map((issue, i) => (
                <li key={i}>{issue}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
