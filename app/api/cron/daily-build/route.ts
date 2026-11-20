import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { refreshDraftWeekFor } from "@/app/(app)/plan/build-actions";
import { addDaysToDateStr, mondayOf, utcInstantToLocal } from "@/lib/time";
import { env } from "@/lib/env";

/**
 * v5 Stage 12c: "a cron at the start of each working day" — one of the
 * handful of events allowed to trigger a build, now that the Week page's
 * own render no longer does. This also covers week rollover implicitly:
 * whichever week is current on the day this runs is the one it builds.
 * Same no-session pattern as the Stage 7 notification cron.
 */
export async function GET(request: Request) {
  const configuredSecret = env.cronSecret();
  if (configuredSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${configuredSecret}`) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
  }

  const supabase = createServiceRoleClient();
  const { data: usersPage, error: usersError } = await supabase.auth.admin.listUsers();
  if (usersError) {
    return NextResponse.json({ ok: false, error: usersError.message }, { status: 500 });
  }
  const user = usersPage.users.find((u) => u.email?.toLowerCase() === env.allowedEmail());
  if (!user) {
    return NextResponse.json({ ok: false, error: "No matching user" }, { status: 404 });
  }

  const weekStart = mondayOf(utcInstantToLocal(new Date(), env.appTimezone()).dateStr);
  await refreshDraftWeekFor(supabase, user.id, weekStart);
  await refreshDraftWeekFor(supabase, user.id, addDaysToDateStr(weekStart, 7));

  return NextResponse.json({ ok: true });
}
