# End-to-end tests (Playwright)

v5 Stage 12b: "Add Playwright. Tests must use real mouse events (down, move,
up), not synthetic drag events... Nothing in Stage 12 to 21 counts as done
until its e2e test passes."

## Blocked on one decision: how do these tests sign in?

The app has exactly one sign-in path — Google OAuth via Supabase Auth
(`app/login`, `app/auth/callback`) — and no test-only bypass. Playwright
needs a real, reusable session to drive any signed-in page at all, so these
tests cannot run yet. Three ways to provide one, in order of how much they
touch the app itself:

1. **A saved `storageState` from a real login.** Run the app locally, sign in
   once by hand in a real browser pointed at it, then export that browser's
   cookies for this origin into `__tests__/e2e/.auth/storage-state.json`
   (gitignored). Works today, zero app changes — but it expires whenever the
   session does, and needs redoing by hand each time, including in CI
   (the file would need to live in CI as a secret, not in the repo).
2. **A short-lived CI sign-in token**, e.g. a Supabase service-role script
   that mints a session for your own user and writes it to the same
   `storage-state.json` path before the suite runs. No new app code — the
   token minting lives in a setup script, not a route — but it does need the
   service-role key available wherever the suite runs.
3. **A dedicated test-sign-in route**, gated behind an env var that's unset
   in production, for CI to use directly. Touches `app/auth` itself, so it's
   the one with the most actual attack surface to reason about, even gated.

My default would be **option 2** (a setup script, no new routes, reusable in
CI) unless you'd rather keep this entirely manual (option 1) or want the
dedicated route (option 3) for some other reason. Tell me which, and I'll
wire it up — the test files below are already written against the plain
`storageState` config, so whichever you pick just needs to produce that one
file.

## What's written and ready to run once auth is sorted

- `drag-and-resize.spec.ts` — drags a block between two days with real
  mouse events (`mouse.down` / `mouse.move` / `mouse.up`, not
  `dragTo`'s synthetic HTML5 drag events, per the brief's explicit
  requirement), opens the editor on a non-round-duration block and checks
  the hours field defaults to its real value, and drags a block within a
  day.
- `reject-undo.spec.ts` — rejects a placed block, checks it reappears in
  Unplaced with a "Rejected" tag, and that Undo restores it.
- `zero-writes-on-load.spec.ts` — loads the Week screen twice and asserts no
  `plan_items`/`weeks` row changes (v5 Stage 12c, V5-01) by reading row
  counts/timestamps through the Supabase REST API with the service-role key
  before and after, rather than inspecting network calls Playwright can't
  see (the writes happen server-to-Supabase, invisible to the browser).

None of these seed their own fixture data yet (the brief's "seed a test week
from fixtures" is still open) — they run against whatever's actually in the
signed-in account's current week, which makes them fragile to real data
changing out from under them. Fixture seeding is the next piece once a
sign-in method is chosen.
