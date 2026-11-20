import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runAsanaSync } from "@/lib/asana/sync";
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

  const result = await runAsanaSync(supabase, user.id);
  // v5 Stage 12c: "build only on... sync completed with changed data" — the
  // input-hash guard inside refreshDraftWeekFor means this is a no-op write
  // when the sync changed nothing, so it's safe to always call it here
  // rather than have this route try to detect "changed" itself.
  if (result.ok) {
    const weekStart = mondayOf(utcInstantToLocal(new Date(), env.appTimezone()).dateStr);
    await refreshDraftWeekFor(supabase, user.id, weekStart);
    await refreshDraftWeekFor(supabase, user.id, addDaysToDateStr(weekStart, 7));
  }
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
