"use client";

import { createClient } from "@/lib/supabase/client";

export function ReconnectCalendarButton() {
  async function reconnect() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        scopes: "https://www.googleapis.com/auth/calendar.readonly",
        queryParams: { access_type: "offline", prompt: "consent" },
      },
    });
  }

  return (
    <button
      onClick={reconnect}
      className="rounded border border-danger bg-danger-tint px-2 py-1 text-xs font-medium text-chalk hover:opacity-90"
    >
      Reconnect calendar
    </button>
  );
}
