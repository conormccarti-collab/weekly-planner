import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { loadSettings } from "@/lib/settings-data";
import { gatherNotificationContent } from "@/lib/notification-data";
import { hasAnythingToReport, renderNotificationEmail } from "@/lib/notification-content";
import { sendEmail } from "@/lib/resend";
import { env } from "@/lib/env";
import { utcInstantToLocal, weekdayOfDateStr } from "@/lib/time";

/**
 * Brief section 10: "one email each weekday morning... off by default...
 * Use a scheduled Vercel cron job." No session here (a cron trigger, not a
 * signed-in browser) — resolves the single allowed user via the admin API
 * and reads everything through the service-role client instead.
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

  const settings = await loadSettings(supabase, user.id);
  if (!settings.notifications_enabled) {
    return NextResponse.json({ ok: true, sent: false, reason: "notifications disabled" });
  }

  const todayStr = utcInstantToLocal(new Date(), env.appTimezone()).dateStr;
  if (!settings.working_days.includes(weekdayOfDateStr(todayStr))) {
    return NextResponse.json({ ok: true, sent: false, reason: "not a working day" });
  }

  const content = await gatherNotificationContent(supabase, user);
  if (!hasAnythingToReport(content)) {
    return NextResponse.json({ ok: true, sent: false, reason: "nothing to report" });
  }

  const { subject, text } = renderNotificationEmail(content, todayStr);
  await sendEmail(env.allowedEmail(), subject, text);

  return NextResponse.json({ ok: true, sent: true });
}
