import { createClient } from "@/lib/supabase/server";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { loadSettings } from "@/lib/settings-data";
import { SettingsForm } from "./settings-form";
import { ReconnectCalendarButton } from "@/components/reconnect-calendar-button";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;

  const initial = user ? await loadSettings(supabase, user.id) : DEFAULT_SETTINGS;

  let calendarNeedsReconnect = false;
  if (user) {
    const { data: lastCalendarSync } = await supabase
      .from("sync_log")
      .select("ok, error")
      .eq("source", "calendar")
      .order("finished_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    calendarNeedsReconnect = lastCalendarSync?.ok === false && lastCalendarSync.error === "RECONNECT_REQUIRED";
  }

  return (
    <div>
      <h1 className="text-lg font-semibold">Settings</h1>
      <p className="mt-1 text-sm text-chalk-dim">
        Working pattern used to compute capacity. Estimate defaults arrive in a later stage.
      </p>

      <section className="mt-6 max-w-xl">
        <h2 className="text-sm font-semibold text-chalk">Connections</h2>
        <div className="mt-2 flex items-center justify-between rounded border border-border px-3 py-2 text-sm">
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
        <div className="mt-2 flex items-center justify-between rounded border border-border px-3 py-2 text-sm">
          <span>Asana</span>
          <span className="text-chalk-dim">Connected (server token)</span>
        </div>
      </section>

      <div className="mt-6">
        <SettingsForm initial={initial} />
      </div>
    </div>
  );
}
