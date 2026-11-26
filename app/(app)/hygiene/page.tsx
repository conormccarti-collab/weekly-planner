import { createClient } from "@/lib/supabase/server";
import { groupTasksByRoot, isInBacklog, type TaskRow } from "@/lib/asana/task-view";
import { checkBrand, checkColumnMatchesStage, checkGroupDates, checkShootInCalendar, checkStale, checkVideoType, isGenuinePipelineDeliverable, type HygieneFlag } from "@/lib/hygiene";
import { isStale } from "@/lib/stale";
import { expandShootDateSpan, matchShootToCalendarEvent, type CalendarEventForMatch } from "@/lib/asana/shoots";
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
      "gid, name, parent_gid, parent_name, project_gids, project_names, section_names, due_on, start_on, completed, custom_fields, permalink_url, assignee_name, is_container, is_plannable, is_shoot, no_longer_assigned"
    )
    .eq("completed", false)
    .eq("no_longer_assigned", false);

  const allTasks = (data as TaskRow[]) ?? [];
  const visibleGroups = groupTasksByRoot(allTasks).filter((g) => !isInBacklog(g.root));
  const todayStr = utcInstantToLocal(new Date(), env.appTimezone()).dateStr;

  // v4: "ignore tasks with a completed or unsynced parent, restrict to
  // Visual Content Pipeline." Production & Shoots has its own check below.
  const pipelineGroups = visibleGroups.filter(isGenuinePipelineDeliverable);

  // v2 (18 Nov 2026): hygiene only ever flags the parent deliverable, never
  // a subtask on its own row — Brand/Video Type/column checks run on the
  // root only; checkGroupDates already attributes its findings to the root.
  const flags: HygieneFlag[] = [];
  for (const group of pipelineGroups) {
    flags.push(...checkGroupDates(group));
    flags.push(...checkColumnMatchesStage(group));
    flags.push(...checkBrand(group.root));
    flags.push(...checkVideoType(group.root));
    flags.push(...checkStale(group, todayStr));
  }

  // v5 Stage 12d.4: "listed once in a 'Needs a new date or closing' panel"
  // — the same stale items (deliverables, and individually stale subtasks
  // of an otherwise-fine deliverable), separate from the per-field flags
  // list above.
  const staleDeliverables: { gid: string; name: string; permalinkUrl: string | null; dueOn: string }[] = [];
  for (const group of pipelineGroups) {
    if (isStale(group.root.due_on, todayStr)) {
      staleDeliverables.push({ gid: group.root.gid, name: group.root.name, permalinkUrl: group.root.permalink_url, dueOn: group.root.due_on as string });
    }
    for (const member of group.descendants) {
      if (member.is_plannable && isStale(member.due_on, todayStr)) {
        staleDeliverables.push({
          gid: member.gid,
          name: `${group.root.name} — ${member.name}`,
          permalinkUrl: member.permalink_url,
          dueOn: member.due_on as string,
        });
      }
    }
  }
  staleDeliverables.sort((a, b) => a.dueOn.localeCompare(b.dueOn));

  // v4 Stage 4a, brief 7.4a: "An unmatched shoot gets a Hygiene flag."
  const shootTasks = allTasks.filter((t) => t.is_shoot);
  const shootSpanByGid = new Map(shootTasks.map((t) => [t.gid, expandShootDateSpan(t.start_on, t.due_on)]));
  const allShootDates = [...new Set([...shootSpanByGid.values()].flat())].sort();
  let calendarEventsForShoots: CalendarEventForMatch[] = [];
  if (allShootDates.length > 0) {
    const { data: eventRows } = await supabase
      .from("calendar_events")
      .select("title, all_day, start_date, end_date, starts_at, busy, response_status")
      .eq("user_id", user.id)
      .or(`and(all_day.eq.true,start_date.lte.${allShootDates[allShootDates.length - 1]},end_date.gte.${allShootDates[0]}),and(all_day.eq.false,starts_at.gte.${allShootDates[0]}T00:00:00Z,starts_at.lte.${allShootDates[allShootDates.length - 1]}T23:59:59Z)`);
    calendarEventsForShoots = (eventRows ?? []).map((r) => ({
      title: r.title as string,
      allDay: r.all_day as boolean,
      startDate: r.start_date as string | null,
      endDate: r.end_date as string | null,
      startsAt: r.starts_at as string | null,
      busy: r.busy as boolean,
      responseStatus: r.response_status as string | null,
    }));
  }
  for (const shoot of shootTasks) {
    const span = shootSpanByGid.get(shoot.gid) ?? [];
    const matched = matchShootToCalendarEvent(shoot.name, span, calendarEventsForShoots) != null;
    flags.push(...checkShootInCalendar(shoot, matched));
  }

  const byTask = new Map<string, { name: string; permalinkUrl: string | null; dueOn: string | null; issues: string[] }>();
  const dueOnByGid = new Map(pipelineGroups.map((g) => [g.root.gid, g.root.due_on]));
  for (const f of flags) {
    const entry = byTask.get(f.gid) ?? { name: f.name, permalinkUrl: f.permalinkUrl, dueOn: dueOnByGid.get(f.gid) ?? null, issues: [] };
    entry.issues.push(f.issue);
    byTask.set(f.gid, entry);
  }

  // Due this week or overdue first, then upcoming-dated, soonest first in
  // each group; undated tasks last, alphabetically.
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
    <div className="mx-auto max-w-3xl">
      <h1 className="text-lg font-semibold">Hygiene</h1>
      <p className="mt-1 text-sm text-chalk-dim">
        Data issues on Visual Content Pipeline deliverables only (not completed, not Backlog, not an orphaned
        subtask whose own parent is completed or unsynced, not individual subtasks otherwise). Covers Brand,
        Video Type, missing dates, a card sitting in the wrong column for its earliest unfinished stage, and a
        Production &amp; Shoots shoot not matched to a calendar event. Due this week or overdue first, then
        upcoming-dated, then undated.
      </p>
      <div className="mt-3">
        <SyncBar asana={asana} calendar={calendar} />
      </div>

      {staleDeliverables.length > 0 && (
        <div className="mt-4 rounded-2xl border border-danger bg-danger-tint p-5">
          <h2 className="text-sm font-bold text-danger">
            Needs a new date or closing ({staleDeliverables.length})
          </h2>
          <p className="mt-1 text-xs text-chalk-dim">
            Overdue by more than 14 days — never placed, never counted At risk, until given a new date or closed in Asana.
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {staleDeliverables.map((d) => (
              <li key={d.gid} className="flex items-center justify-between gap-2">
                {d.permalinkUrl ? (
                  <a href={d.permalinkUrl} target="_blank" rel="noreferrer" className="font-medium text-info underline">
                    {d.name}
                  </a>
                ) : (
                  <span className="font-medium text-chalk">{d.name}</span>
                )}
                <span className="text-xs text-chalk-dim">was due {d.dueOn}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-4 text-sm font-bold text-chalk">
        {rows.length === 0 ? "No issues found." : `${rows.length} task${rows.length === 1 ? "" : "s"} flagged.`}
      </p>

      <ul className="mt-2 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-slate">
        {rows.map(([gid, row]) => (
          <li key={gid} className="px-5 py-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              {row.permalinkUrl ? (
                <a href={row.permalinkUrl} target="_blank" rel="noreferrer" className="font-bold text-chalk hover:text-info">
                  {row.name}
                </a>
              ) : (
                <span className="font-bold text-chalk">{row.name}</span>
              )}
              {row.dueOn && <span className="text-xs text-chalk-dim">due {row.dueOn}</span>}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {row.issues.map((issue, i) => (
                <span key={i} className="rounded-full bg-warning-chip px-2.5 py-0.5 text-[11px] font-bold text-chalk">
                  {issue}
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
