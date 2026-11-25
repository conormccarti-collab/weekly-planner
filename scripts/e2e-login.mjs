#!/usr/bin/env node
// v5 Stage 12b: mints a real Playwright session for the app's one real
// user, entirely locally. The service-role key is used here only, to
// generate a one-time Supabase magic-link token (the same mechanism a real
// "email me a sign-in link" flow uses) — it never touches the resulting
// session or leaves this process. The actual cookie is produced by running
// @supabase/ssr's own createServerClient against that token, so the cookie
// name/shape/encoding is exactly what the real app would set — nothing
// hand-guessed, no application code touched or modified.
//
// Usage: node scripts/e2e-login.mjs
// Writes: __tests__/e2e/.auth/storage-state.json (gitignored)

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: `${__dirname}/../.env.local` });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL = process.env.ALLOWED_EMAIL;
const OUT_PATH = `${__dirname}/../__tests__/e2e/.auth/storage-state.json`;

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY || !EMAIL) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY / ALLOWED_EMAIL in .env.local");
  process.exit(1);
}

// 1. Service-role-only step: mint a one-time magic-link token for the real user.
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email: EMAIL });
if (linkError || !linkData?.properties?.hashed_token) {
  console.error("Failed to generate magic link:", linkError?.message ?? "no hashed_token returned");
  process.exit(1);
}
const tokenHash = linkData.properties.hashed_token;

// 2. Verify that token through the real @supabase/ssr server client, so the
// cookie(s) it writes are byte-for-byte what the app's own login would
// produce — no hand-crafted cookie encoding.
const collectedCookies = [];
const ssrClient = createServerClient(SUPABASE_URL, ANON_KEY, {
  cookies: {
    getAll: () => [],
    setAll: (cookiesToSet) => {
      for (const { name, value } of cookiesToSet) collectedCookies.push({ name, value });
    },
  },
});

const { data: verifyData, error: verifyError } = await ssrClient.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
if (verifyError || !verifyData?.session) {
  console.error("Failed to verify magic link:", verifyError?.message ?? "no session returned");
  process.exit(1);
}

if (collectedCookies.length === 0) {
  console.error("verifyOtp succeeded but no cookies were captured — check @supabase/ssr's onAuthStateChange still fires synchronously for SIGNED_IN.");
  process.exit(1);
}

// 3. Write Playwright's storageState.json format, reusing @supabase/ssr's
// own default cookie attributes (path "/", sameSite "lax", 400-day maxAge).
const expires = Math.floor(Date.now() / 1000) + 400 * 24 * 60 * 60;
const storageState = {
  cookies: collectedCookies.map(({ name, value }) => ({
    name,
    value,
    domain: "localhost",
    path: "/",
    expires,
    httpOnly: false,
    secure: false,
    sameSite: "Lax",
  })),
  origins: [],
};

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify(storageState, null, 2));
console.log(`Wrote ${collectedCookies.length} cookie(s) for ${verifyData.user.email} to ${OUT_PATH}`);
