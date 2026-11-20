"use client";

import { createClient } from "@/lib/supabase/client";

// Requests calendar.readonly + offline access in the same consent as sign-in,
// per the brief: one Google consent covers both sign-in and calendar access.
export function SignInButton() {
  async function signIn() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        scopes: "https://www.googleapis.com/auth/calendar.readonly",
        queryParams: {
          access_type: "offline",
          prompt: "consent",
        },
      },
    });
  }

  return (
    <button
      onClick={signIn}
      className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90"
    >
      Continue with Google
    </button>
  );
}
