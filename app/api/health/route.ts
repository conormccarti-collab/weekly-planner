import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { loadSyncStatuses } from "@/lib/sync-status";
import { env } from "@/lib/env";

/**
 * v5 Stage 12a.6: "Add /api/health returning the last sync time for Asana
 * and Calendar." No session (an external monitor, not a signed-in
 * browser) — service-role client, same pattern as the cron routes.
 */
export async function GET() {
  const supabase = createServiceRoleClient();
  const { data: usersPage, error: usersError } = await supabase.auth.admin.listUsers();
  if (usersError) {
    return NextResponse.json({ ok: false, error: usersError.message }, { status: 500 });
  }
  const user = usersPage.users.find((u) => u.email?.toLowerCase() === env.allowedEmail());
  if (!user) {
    return NextResponse.json({ ok: false, error: "No matching user" }, { status: 404 });
  }

  const { asana, calendar } = await loadSyncStatuses(supabase);
  return NextResponse.json({
    ok: true,
    asana: { lastSyncedAt: asana.lastSyncedAt, lastSyncError: asana.lastSyncError },
    calendar: { lastSyncedAt: calendar.lastSyncedAt, lastSyncError: calendar.lastSyncError },
  });
}
