# Weekly Planner — as-built spec for v3 (plan-first behaviour)

Written 2026-11-20, for handing to another Claude session (or a human) to see
exactly what plan-first changed, on top of the Release 1/1.1 state already
written up in `SPEC_AS_BUILT_FOR_V2.md`. That document and `BUILD_BRIEF.md`
(v1.2) remain the spec of record for anything not called out below as
superseded. The source brief for this work is
`~/Desktop/work-assistant-brief-v3-plan-first.md` (v1.0, 19 November 2026) —
the only copy of it that exists; there is no v1.1 revision of that brief.

This is the **first version of the app that has ever been committed to git**
— everything described in `SPEC_AS_BUILT_FOR_V2.md` and everything below
landed in a single commit (`aeb0848`) on top of the original
`create-next-app` scaffold, because no commits had been made across any
prior session. It is deployed to production at
**https://weekly-planner-pi-ruby.vercel.app** (Vercel project `weekly-planner`,
no git remote — deploys are pushed directly from the local working tree with
`vercel --prod`, not via git integration).

## 1. What plan-first changes, behaviourally

The pre-v3 app required building each week by hand: open an empty grid, drag
tasks on (or use "Place…"), optionally click **Propose automatic placement** /
**Check over capacity** / **Morning check** as separate opt-in buttons, then
**Save plan**. A **Planning session** screen walked through these steps.

v3 inverts this: the week is already laid out as a *proposed* plan the moment
the app opens, built from the same ranking/placement engine that already
existed. The user's job becomes reviewing and adjusting a proposal — drag,
resize, remove, mark Must, or ask chat — then clicking one **Accept plan**
button. The Planning session screen is gone; its steps now live on the Week
screen itself.

## 2. Schema changes (migrations 0014, 0015)

- **`plan_items.pinned boolean not null default false`** — set whenever a
  row is created or touched by a manual action (`placeBlock`, `moveBlock`,
  `splitBlock` in `app/(app)/plan/actions.ts`). A pinned row is never
  touched by the auto-build/refresh logic.
- **`plan_items.status` check constraint extended** to add `'provisional'`
  (alongside the existing `'planned' | 'done' | 'behind' | 'moved'`) — a
  synthetic one-hour placeholder for a task with no real estimate.
- **No new `'proposed'` status, and no new column on `weeks` either.**
  "Proposed-ness" is derived at render time, not stored: a block is Proposed
  (this week) or Draft (next week) purely from `weeks.status === 'draft' &&
  !plan_items.pinned`. `weeks.status` ('draft'/'saved') is the same column
  Release 1 already had; "Accept plan" is `saveWeekPlan` in
  `app/(app)/plan/actions.ts`, repurposed rather than rebuilt.
- **`refresh_draft_week_items(...)`** (migration 0015) — a Postgres function
  that does the actual delete-unprotected-then-insert-then-move-to-next-week
  work inside `pg_advisory_xact_lock(hashtext(user_id || ':' || week_start))`.
  It re-derives "what's currently unprotected" from the database at execution
  time rather than trusting a JS-side read taken before the lock — see §6 for
  why this exists.

## 3. The core write-and-merge engine

| Function | File | Role |
|---|---|---|
| `gatherWeekBuildInputs` | `lib/plan-build-data.ts` | Reads tasks, existing `plan_items`, free blocks, blockers for one week; returns `WeekBuildInputs` |
| `partitionProtected` | `lib/plan-build.ts` | Pure: a row is protected if `pinned \|\| status in ('done','behind') \|\| day < today` |
| `buildWeekPlan` | `lib/plan-build.ts` | Pure: given inputs, returns the rows to delete/insert/move — the one shared implementation |
| `refreshDraftWeek(weekStart)` | `app/(app)/plan/build-actions.ts` | The orchestrator: gathers inputs, calls `buildWeekPlan`, writes via the `refresh_draft_week_items` RPC. No-ops if the week is `'saved'`. |

`refreshDraftWeek` is called for **both** the current and following week on
every load of the Week screen (`app/(app)/page.tsx`) and after
`confirmPersonalTasks` adds a task via chat (§7). One function, called from
multiple places — not two implementations for "silent while draft" vs.
"banner after accepted."

Ranking and placement themselves are unchanged from Release 1.1 and reused
as-is:
- `orderCandidatesForPlacement` (`lib/auto-placement.ts`) — Must → hard
  deadline (parent publish date, or Must) → **back-scheduling tier omitted,
  see §9** → priority → due date → stage order.
- `proposeAutoPlacement` (`lib/auto-placement.ts`) — deep work into longest
  free blocks first, shallow work fills gaps, respects the minimum
  deep-work-block setting.
- `proposeOverCapacityMoves` (`lib/over-capacity.ts`) — unchanged; triggered
  automatically inside the build rather than by a button.
- `unfinishedBlockers` (`lib/asana/dependencies.ts`) — a blocked task is
  excluded from auto-build eligibility entirely (not just warned about after
  placement, which is still the behaviour for a *manual* placement).

## 4. Accept plan + "things have changed"

- **Accept** (`saveWeekPlan`): flips `weeks.status` to `'saved'`. Every block
  that was Proposed/Draft becomes a normal block the instant the week is
  accepted — no per-row conversion, since "Proposed" was only ever a
  render-time label.
- **Post-acceptance drift**: `computeWeekChanges(weekStart)`
  (`app/(app)/plan/changes-actions.ts`) runs only for a `'saved'` week. It
  treats every existing row as protected and asks "what's eligible that has
  **no row at all** yet?" — a new Asana task, something newly flagged Must,
  something now due. Candidates are ranked and placed into whatever free time
  remains; anything that can't be placed is still surfaced (`needsEstimate`)
  rather than silently dropped. Rendered via `WeekChangesBanner`
  ("Things have changed. Review a new proposal?") with Approve
  (`applyWeekChanges` — inserts only the new rows, touches nothing existing)
  and Reject (dismiss).
- This is deliberately scoped to **additions only**, not a full
  reshuffle-against-baseline diff — an accepted plan's existing blocks are
  never moved by this path, only ever added to.

## 5. Provisional estimates

- The five-tier estimate precedence (`resolveEstimate` in `lib/estimates.ts`)
  is unchanged. What changed is the caller: a task that resolves to
  `origin === 'none'` used to be skipped entirely during auto-build. It is
  now placed with a synthetic one-hour estimate and `status = 'provisional'`.
- Calendar UI (`components/calendar-grid.tsx`): a provisional block renders
  with a diagonal hatch (`repeating-linear-gradient`) and a "needs estimate"
  chip.
- Resizing a provisional block, or typing a real estimate, flips it to
  `status: 'planned'`, sets `pinned: true`, and writes the user's confirmed
  estimate via the existing override path (`moveBlock` in
  `app/(app)/plan/actions.ts`).
- The week header (`components/dashboard.tsx`) splits hours into confirmed
  vs. provisional (`weekProvisionalHours`, computed in
  `lib/week-view-data.ts`).

## 6. Concurrency fix discovered during Stage 3 verification

Live testing surfaced 54 duplicate rows in a draft week, caused by
overlapping `refreshDraftWeek` calls (triggered by rapid Next.js Fast Refresh
reloads while files were being edited). The original implementation read
"what's unprotected" in JS, then issued separate delete and insert calls —
three unprotected round trips that two concurrent callers could interleave
across.

Fixed by moving the whole delete+insert (+ move-to-next-week) sequence into
the single `refresh_draft_week_items` Postgres function (migration 0015),
executed under `pg_advisory_xact_lock` keyed on `(user_id, week_start)`. The
function re-derives "unprotected" state from the database *inside* the lock,
so even genuinely overlapping calls each see a consistent, current view —
correct by construction regardless of call count or ordering, not just
empirically non-duplicating under the cases actually tried.

## 7. The summary panel (new — nothing like this existed before v3)

- `lib/summary.ts` — `buildWeekSummaryFacts(data, workingDays, nowMinutes)`
  is a pure facts-assembler built entirely from data `loadWeekViewData`
  already returns (no new queries): the current/next blocks by clock time,
  today's planned/capacity/done hours, an at-risk list (ended-not-done,
  deadlines within two working days, over-capacity, needs-estimate),
  next week's planned/capacity/top-three/cannot-fit, and — only on the first
  desk day — Monday's working hours and what was left out.
  `templateSummary(facts)` renders a fixed-template fallback from the same
  object.
- `phraseWeekSummary(facts)` (`lib/chat/claude.ts`) — a one-shot, non-tool-use
  Anthropic call (reusing the module's lazy-client pattern) that turns the
  facts object into 2–3 plain sentences. It is given the facts as JSON and
  instructed never to add or alter a number; if the call throws, the caller
  falls back to `templateSummary`.
- `components/week-summary.tsx` — renders the phrased (or template) text.
  `components/summary-auto-refresh.tsx` — ticks every 5 minutes via
  `router.refresh()` while the app is open (same pattern as `SyncBar`'s own
  interval).
- **Same-day "ended, not done" prompts**: a block whose end time has passed
  *today* (not just a prior day) is surfaced under At risk with one-tap
  Done/On track/Behind answers (`components/same-day-check.tsx`,
  `app/(app)/summary/actions.ts: submitSameDayCheck`). This reuses
  `resolveMorningCheckUpdate` (`lib/morning-check.ts`) verbatim — "Moved" in
  the brief's wording maps onto the existing `on_track` outcome rather than
  inventing a fourth one.

## 8. Chat

Only one of the five existing tools changed behaviour: `confirmPersonalTasks`
(`app/(app)/chat/actions.ts`) now calls `refreshDraftWeek` for both the
current and following week immediately after inserting the confirmed rows,
so a task added via chat is placed into the plan instead of landing unplaced.
The other four tools (`proposeIdeas`, `answerQuestion`, and the two batch
paths) needed no logic change — only re-verification that they still behave
correctly against a draft (not-yet-accepted) week, which they do, since they
don't touch `plan_items` directly.

## 9. Deliberately deferred: back-scheduling ranking tier

Brief §5's ranking order has a third tier — "Latest start from
back-scheduling (pull R2.2 forward and use it here)" — referring to
`BUILD_BRIEF.md`'s Release 2 item 2: *"Back-scheduling: from the publish date
on a deliverable, work out the latest start of each stage and warn when one
must start this week."* That rule doesn't exist yet (Release 2 is scoped for
January 2027). Confirmed with the user (2026-11-20) that this stays deferred
until R2.2 is actually built. `orderCandidatesForPlacement` currently falls
through from hard-deadline straight to priority, skipping this tier; adding
it later is a one-line insertion into that same ranking chain, not a
restructuring.

## 10. Retiring the Planning session, and what moved where

Deleted entirely: `app/(app)/planning/`, `app/(app)/auto-placement/`,
`app/(app)/over-capacity/`, `components/must-checklist.tsx`,
`components/save-plan-button.tsx`, `components/open-chat-button.tsx`,
`components/auto-placement-panel.tsx`, `components/over-capacity-panel.tsx`,
and the nav link. The underlying pure functions these buttons called
(`proposeAutoPlacement`, `proposeOverCapacityMoves`, `orderCandidatesForPlacement`)
were kept — they're now called internally by `refreshDraftWeek` and
`computeWeekChanges` instead of by a click.

Where each retired step now lives:
- **Sync status** — already on the Week screen (`SyncBar`); unchanged.
- **Chat as the Monday-list entry point** — already on the Week screen
  (floating chat button); unchanged.
- **Must flags** — previously only available on *unplaced* rows in
  `plan-board.tsx`. Since tasks now mostly arrive already placed, a Must
  checkbox was added to the placed-block editor in `calendar-grid.tsx`'s
  `BlockEditor`, wired through `onToggleMust` in `plan-board.tsx`.
- **Morning check** — previously a manual button
  (`components/morning-check-panel.tsx` used to self-trigger). It now runs
  automatically on every page load via `computeMorningCheck()` in
  `app/(app)/page.tsx`, and the panel renders nothing when there's nothing to
  check (`MorningCheckPanel({ initial })` takes the server-computed result
  directly).
- `/planning` is kept as a bare redirect to `/` (`app/(app)/planning/page.tsx`)
  rather than left to 404, for anyone with the old URL bookmarked.

## 11. Fixed this session, outside the plan proper

- **`components/sync-bar.tsx` hydration mismatch** — `formatAge()` compared
  `Date.now()` at server-render time against `Date.now()` at client
  hydration time, which could disagree across a minute boundary ("just now"
  vs. "1 minute ago"). Fixed by holding the clock in `useState<number |
  null>(null)`, set only inside `useEffect` (so the server render and the
  first client render both show a fixed `"—"` placeholder, then swap to the
  real value post-mount, re-ticking every 30s).
- Confirmed (not changed — already correct): `computeMorningCheck` returns
  empty when there are no prior desk days this week (`priorDays.length === 0`
  guard), so the panel stays silent on the week's first desk day; and
  `computeWeekChanges` vs. `computeMorningCheck` can never surface the same
  task, since one only ever concerns rows with no placement yet and the
  other only ever concerns existing placed rows from past days.

## 12. Acceptance table against the v1.0 brief (sections 3–10)

No section numbered 11 with ten acceptance tests exists in any brief on disk
— checked `work-assistant-brief-v3-plan-first.md` (only a v1.0 exists) and
`BUILD_BRIEF.md` (v1.2). The table below is built from the v1.0 brief's full
feature set instead:

| # | Requirement | Result |
|---|---|---|
| 1 | Week auto-builds as proposed/draft on open, no button (§3.1, §4.1) | PASS |
| 2 | Proposed/draft blocks outlined + labelled (§3.2, §4.3) | PASS |
| 3 | Accept plan; re-plan never moves pinned/Done/past (§3.3, §3.5, §10.2) | PASS |
| 4 | "Things have changed" banner, no silent rebuild post-accept (§3.4) | PASS |
| 5 | Next week refreshed until touched; edits pin the block (§4.1–4.2) | PASS |
| 6 | Ranking order + never before a blocker (§5, §10.5) | PASS, back-scheduling tier deferred to R2.2 (§9 above) |
| 7 | Provisional 1h hatched block; confirm on resize/type; hour split (§6) | PASS |
| 8 | Summary: Now/Next/Today/At-risk/Next-week, template fallback, 5-min refresh, same-day prompts (§7) | PASS |
| 9 | Chat-confirmed task lands in the plan; tweaks stay Approve/Reject (§8) | PASS |
| 10 | Planning screen retired; steps redistributed; standalone buttons gone (§9) | PASS |

All verified by a combination of unit tests (229/229 passing,
`npx vitest run`), `tsc --noEmit` (clean), and live browser checks against
real signed-in data, following this project's established discipline of
driving synthetic test data through the real UI (or direct SQL using a real
existing task reference, never a fabricated one) and reverting afterward.

## 13. Not yet built

Unchanged from `SPEC_AS_BUILT_FOR_V2.md` §4 — everything under
`BUILD_BRIEF.md`'s Release 2 (estimates from Content Type templates,
back-scheduling, Shoots-matched-to-calendar, Discovery batches, Slack
forward-to-create, notifications, estimate report, read-only colleague view,
Asana write-back) and "Not planned" sections. Nothing in Release 2 has been
started.

## 14. Deploy state

First-ever git commit of this codebase (`aeb0848`, on top of the original
`create-next-app` commit — no remote configured). Deployed to production via
`vercel --prod`: **https://weekly-planner-pi-ruby.vercel.app**. Build was
clean (TypeScript, static generation). `/planning`'s redirect and the home
screen were both spot-checked live on the production URL after deploy.
