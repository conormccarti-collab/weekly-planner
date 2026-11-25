# End-to-end tests (Playwright)

Signed-in session: a saved `storageState` at `__tests__/e2e/.auth/storage-state.json`
(gitignored), referenced by `playwright.config.ts`. Regenerate it by signing
in once by hand against a real run of the app and exporting that session.

Every spec here runs against the **dev Supabase project**, never the real
production one, using disposable fixtures from `fixtures.ts`
(`createFixtureBlocks`, `createUnplacedFixture`, `createFixtureMeeting`) —
never real synced data. `assertNoRealDataTouched` is a second, independent
safety net: it fails the test loudly if anything outside the fixtures a test
created was touched, which has caught real cross-test and cross-file
interference more than once (see `playwright.config.ts`'s `workers: 1` and
the comments throughout `fixtures.ts`).

Week-list rebuild: dragging no longer exists anywhere in the app — every
interaction goes through the Edit button (`EditEntryModal`), the Place…
button (`PlaceModal`), or chat. Specs drive these as plain clicks and
`selectOption` calls, which is both simpler and more reliable than the
pointer-drag simulation the old calendar-grid UI needed.

## What's here

- `edit-and-place-modals.spec.ts` — the core proof that the push/redirect/
  split engine (`resolveDrop`) works the same through the tap UI as it used
  to through a drag: editing a block onto an occupied slot pushes the
  occupant later, onto a meeting redirects to the nearest free slot, and a
  duration that runs past the end of the day splits across the day boundary
  (both via the Edit modal's Save and the Place modal) — plus a plain
  place-and-reload check.
- `reject-undo.spec.ts` — removes a placed block via the Edit modal, checks
  it reappears in Unscheduled with a "Rejected" tag, and that Undo restores
  it exactly.
- `zero-writes-on-load.spec.ts` — loads the Week screen twice and asserts no
  `plan_items`/`weeks` row changes (v5 Stage 12c, V5-01), reading row
  counts/timestamps through the Supabase REST API with the service-role key
  rather than inspecting network calls (the writes happen server-to-Supabase,
  invisible to the browser).

## Known fragility

The app has no week-navigation, so every spec is constrained to whichever
two weeks the Week screen actually renders ("this week" and "next week").
As real dates roll forward, the real auto-build naturally fills those same
weeks with real, legitimate work — which has twice now caused a spec to
collide with real (non-fixture) rows and trip `assertNoRealDataTouched` for
real, not as a false positive. When that happens: it's not a code bug,
restore the affected week with a real resync (click Refresh, or call the
`/api/sync/asana` route for a signed-in session) and re-run. A proper fix
needs either a dedicated test-only Supabase project or a way to pin these
tests to a week the real build will never touch — worth doing before this
suite grows much further.
