import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { encrypt } from "@/lib/crypto";
import { env } from "@/lib/env";

// Exchanges the Google OAuth code for a session, rejects anyone but
// ALLOWED_EMAIL, and persists the calendar refresh token (encrypted) that
// comes back from this same one-time consent for use by calendar sync later.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.session) {
    return NextResponse.redirect(`${origin}/login?error=exchange_failed`);
  }

  const { session, user } = data;
  const allowedEmail = env.allowedEmail();

  if (user.email?.toLowerCase() !== allowedEmail) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=not_allowed`);
  }

  if (session.provider_refresh_token) {
    const serviceClient = createServiceRoleClient();
    await serviceClient.from("oauth_tokens").upsert({
      user_id: user.id,
      provider: "google_calendar",
      refresh_token_encrypted: encrypt(session.provider_refresh_token),
      updated_at: new Date().toISOString(),
    });
  }

  return NextResponse.redirect(`${origin}/`);
}
