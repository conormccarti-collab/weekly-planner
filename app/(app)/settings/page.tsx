import { createClient } from "@/lib/supabase/server";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { loadSettings } from "@/lib/settings-data";
import {
  PIPELINE_PROJECT_GID,
  PIPELINE_PROJECT_NAME,
  PRODUCTION_SHOOTS_PROJECT_GID,
  PRODUCTION_SHOOTS_PROJECT_NAME,
} from "@/lib/asana/projects";
import { loadAllEstimateDefaults } from "@/lib/estimates-data";
import { SettingsForm } from "./settings-form";
import { EstimateDefaultsForm } from "./estimate-defaults-form";
import { SchedulingRulesForm } from "./scheduling-rules-form";
import { listSchedulingRules } from "./rules-actions";
import { ReconnectCalendarButton } from "@/components/reconnect-calendar-button";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;

  const initial = user ? await loadSettings(supabase, user.id) : DEFAULT_SETTINGS;
  const estimateDefaults = await loadAllEstimateDefaults(supabase);
  const schedulingRules = user ? await listSchedulingRules() : [];

  // v5 Stage 12d.1: "A setting 'Planned projects' lists the included
  // projects" — every project ever seen by a sync, so the user can opt
  // additional ones in (or the two defaults out) without typing a gid.
  const { data: projectRows } = await supabase.from("asana_projects").select("gid, name").order("name");
  // The two hardcoded default projects (lib/asana/projects.ts) are only ever
  // synced into asana_projects as a side effect of a task existing in them —
  // a project with zero current tasks (e.g. Production & Shoots between
  // shoots) would otherwise have no checkbox at all, even though it's one of
  // the defaults the app always treats as planned.
  const knownProjectsByGid = new Map((projectRows ?? []).map((p) => [p.gid, p]));
  knownProjectsByGid.set(PIPELINE_PROJECT_GID, { gid: PIPELINE_PROJECT_GID, name: PIPELINE_PROJECT_NAME });
  knownProjectsByGid.set(PRODUCTION_SHOOTS_PROJECT_GID, {
    gid: PRODUCTION_SHOOTS_PROJECT_GID,
    name: PRODUCTION_SHOOTS_PROJECT_NAME,
  });
  const knownProjects = [...knownProjectsByGid.values()].sort((a, b) => a.name.localeCompare(b.name));

  let calendarNeedsReconnect = false;
  let recentSyncFailures = 0;
  if (user) {
    const { data: lastCalendarSync } = await supabase
      .from("sync_log")
      .select("ok, error")
      .eq("source", "calendar")
      .order("finished_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    calendarNeedsReconnect = lastCalendarSync?.ok === false && lastCalendarSync.error === "RECONNECT_REQUIRED";

    // v5 Stage 12a.5: "show a small 'problems' count in Settings" — recent
    // sync failures are a real, already-logged signal; no new table needed.
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("sync_log")
      .select("id", { count: "exact", head: true })
      .eq("ok", false)
      .gte("started_at", sevenDaysAgo);
    recentSyncFailures = count ?? 0;
  }
  const sentryConfigured = !!process.env.SENTRY_DSN;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-lg font-semibold">Settings</h1>
      <p className="mt-1 text-sm text-chalk-dim">Working pattern used to compute capacity.</p>

      <div className="mt-6 space-y-4">
        <section className="rounded-2xl border border-border bg-slate p-5">
          <h2 className="text-sm font-bold text-chalk">Connections</h2>
          <div className="mt-2 flex items-center justify-between rounded-lg border border-border bg-raven px-3 py-2 text-sm">
            <span>Google Calendar</span>
            {calendarNeedsReconnect ? (
              <div className="flex items-center gap-2">
                <span className="text-danger">Needs reconnecting</span>
                <ReconnectCalendarButton />
              </div>
            ) : (
              <span className="text-chalk-dim">Connected</span>
            )}
          </div>
          <div className="mt-2 flex items-center justify-between rounded-lg border border-border bg-raven px-3 py-2 text-sm">
            <span>Asana</span>
            <span className="text-chalk-dim">Connected (server token)</span>
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-slate p-5">
          <h2 className="text-sm font-bold text-chalk">Problems</h2>
          <div className="mt-2 flex items-center justify-between rounded-lg border border-border bg-raven px-3 py-2 text-sm">
            <span>Sync failures (last 7 days)</span>
            <span className={recentSyncFailures > 0 ? "text-danger" : "text-chalk-dim"}>{recentSyncFailures}</span>
          </div>
          <div className="mt-2 flex items-center justify-between rounded-lg border border-border bg-raven px-3 py-2 text-sm">
            <span>Error logging</span>
            <span className="text-chalk-dim">{sentryConfigured ? "Sentry configured" : "Sentry not configured (SENTRY_DSN unset)"}</span>
          </div>
        </section>

        <SettingsForm initial={initial} knownProjects={knownProjects} />
        <SchedulingRulesForm initial={schedulingRules} />
        <EstimateDefaultsForm initial={estimateDefaults} />
      </div>
    </div>
  );
}
