import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runCalendarSync } from "@/lib/calendar/sync";
import { refreshDraftWeekFor } from "@/app/(app)/plan/build-actions";
import { addDaysToDateStr, mondayOf, utcInstantToLocal } from "@/lib/time";
import { env } from "@/lib/env";

export async function POST() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;

  if (!user || user.email?.toLowerCase() !== env.allowedEmail()) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const result = await runCalendarSync(supabase, user.id, env.appTimezone());
  // v5 Stage 12c: see the Asana sync route — same "build on sync completed" trigger.
  if (result.ok) {
    const weekStart = mondayOf(utcInstantToLocal(new Date(), env.appTimezone()).dateStr);
    await refreshDraftWeekFor(supabase, user.id, weekStart);
    await refreshDraftWeekFor(supabase, user.id, addDaysToDateStr(weekStart, 7));
  }
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
