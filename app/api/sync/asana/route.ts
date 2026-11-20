import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runAsanaSync } from "@/lib/asana/sync";
import { env } from "@/lib/env";

export async function POST() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;

  if (!user || user.email?.toLowerCase() !== env.allowedEmail()) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const result = await runAsanaSync(supabase, user.id);
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
