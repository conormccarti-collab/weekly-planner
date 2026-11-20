# Weekly Planner — as-built spec for v4 (brief completion, Release 2 folded in)

Written 2026-11-20. Covers everything built on top of
`SPEC_AS_BUILT_FOR_V3.md` (plan-first v3) from
`~/Desktop/work-assistant-brief-v4-complete.md` (v1.0, 20 November 2026).
That brief's eleven stages map to git history as below. **Not deployed** —
every commit described here is local only, per the standing instruction "no
deploy until I say so."

## Stage-by-stage status

| Stage | Commit(s) | Status |
|---|---|---|
| 1. Checklist + quick fixes | `9b94ef7` | Built |
| 2. Plan-first corrections (v1.1) | `ec9d2cc` | Built |
| 3. Carry-overs + Office picker | `9c0933a` | Built |
| 4. Shoots matched to calendar, back-scheduling | `2e3c5be` | Built |
| 5. Discovery batches and episodes | `f6323b0` | Built, scoped per your instruction (no batch-collapsing) |
| 6. Estimate report | `bfbe50e` | Built |
| 7. Notifications | `046fc08` | Built, **cannot send live yet — no `RESEND_API_KEY` in `.env.local`** |
| 8. Slack forward-to-create | — | **Deferred by your instruction — not built** |
| 9. Read-only workload view | — | **Deferred by your instruction — not built** |
| 10. Write-back to Asana | `d874d8a`, `ee10ea6` | Built |
| 11. Full acceptance + final deploy | this document | Acceptance done; **deploy withheld per your instruction** |

Also folded in outside the numbered stages: the Behind-with-hours-left
remainder placement (`2ca72a3`), the deferred migration to re-tighten
`plan_items_status_check` once the new build ships (`f1f4a7a`), and five
production bugs you found by testing the still-live old build in a browser
(`98b5863`): the duration-dropdown default, the block editor's
overflow/overlap, missing parent-task names + hour ruler on blocks, native
drag-and-drop's missing `dataTransfer` calls, and a Projects phantom-label
bug from joining unrelated projects into one combined key.

## 1. Stage 1 — checklist + quick fixes

Audited every item in `BUILD_BRIEF.md` v1.2 §5–10, v1.3, and Release 1.1
against the actual code. Two real gaps found and fixed: phone layout now
stacks day columns below the `sm` breakpoint, and estimate defaults are
editable from Settings with changes logged to `estimate_history` (via the
service-role client — the table is global config with no RLS write policy).
Brand-from-parent reading and the Hygiene restriction to Visual Content
Pipeline were both re-confirmed correct live during Stage 5 (see below), not
just read from code.

## 2. Stage 2 — plan-first corrections to match v1.1

- Suggested estimates (migration 0017: `provisional` → `suggested`) replace
  the one-hour placeholder: a real Anthropic call fills tier 4 when there's
  no user/learned/default figure, cached to `task_meta`, placed but excluded
  from totals until confirmed by one tap or by resizing.
- Docked, week-long, persisted chat panel on the Week screen (migration
  0018: `chat_messages`); still a popup elsewhere.
- Chat can edit the draft directly — Must, move/resize, remove, park,
  estimate, "what's at risk", "regenerate" — confirming inline on an
  unambiguous match, same two-phase (model classifies, code matches, user
  confirms) pattern as before.
- Each draft block has its own Approve/Reject alongside Accept plan.
- Week summary covers six lines for this week, three for next, on top of
  the existing Now/Next/Today/At-risk strip.
- "Moved" is its own outcome in the morning check and same-day prompts,
  clearing the placement rather than folding into On track.

Migrations 0017 and 0018 are now applied (confirmed by you). 0017 was
widened mid-migration to accept both `provisional` and `suggested`, because
the then-still-live old build kept writing `provisional` rows; migration
0020 (**do not run until this new build is deployed**) drops `provisional`
again once it's safe.

## 3. Stage 3 — carry-overs and the Office picker

Office picker, dependency-warnings-on-manual-placement, and shoot tasks on
the calendar were already built from earlier work (confirmed, not
duplicated). Added: a persistent "blocked" badge on a placed block whose
task has an unfinished blocker (previously only a transient toast), Video
Type matching that trims whitespace and accepts "Trade Partner" as "Trade"
specifically on Production & Shoots, and a "last synced" indicator on
Projects and Hygiene.

Documented gap at the time (now closed by the Behind-remainder work below):
morning check's "Behind" outcome wrote `task_meta.remaining_hours` but
nothing read it back into re-placement.

## 4. Stage 4 — shoots matched to calendar, then back-scheduling

- **4a**: a shoot task matches a real calendar event on its date span (an
  all-day/multi-day busy event, or a timed event sharing a distinctive word
  with the shoot name) — read-only, never creates or edits an event. A
  matched shoot shows the event; an unmatched one gets a "Shoot not in
  calendar" Hygiene flag.
- **4b**: for each deliverable with a publish date, works backwards through
  its plannable subtasks' *confirmed* estimates (never a suggested one) to
  find each stage's latest start, skipping zero-capacity (leave) days,
  respecting a stage's own due date as its deadline, warning when the Edit
  due date doesn't leave enough room for what follows it. Surfaced as a
  "Starts this week" list on the Week screen, and slotted into
  `orderCandidatesForPlacement` as its own tier between hard deadline and
  priority — the tier every earlier stage's plan deferred pending this rule.
  Unit-tested against a fixture with a leave week in it, per the brief's own
  "done when."

The per-day capacity this draws on is the flat working-day model from
Settings, not full calendar lookahead months out — deliberately, since
back-scheduling is proposals/warnings only.

## 5. Stage 5 — Discovery batches and episodes

Per your explicit scoping instruction: **no collapsing of a batch into one
block** — a batch's stages place exactly as any other deliverable's do.
Added only the series grouping: a batch and its episodes ("Series: Batch N",
"Series: Ep N") share a detected series name and render together under one
heading in Everything else; an ordinary deliverable is unaffected. Each
episode back-schedules off its own publish date — falls out of Stage 4b's
per-deliverable computation with no further change needed. Tested with the
brief's own fixture (one batch, three episodes, grouped).

**Hygiene scoping fix**, found while re-syncing per your instruction: a
subtask whose real parent was completed (and so excluded by the sync's own
filter) or never synced was silently becoming its own "root" and getting
checked as if it were a genuine deliverable. Fixed by excluding any root
with a non-null `parent_gid`, and scoping both the Hygiene screen and the
week summary's hygiene line to Visual Content Pipeline only. Re-synced and
confirmed live: flagged-task count dropped from 24 to 19 between your ~25
closed tasks and this fix together. Brand inheritance from Pipeline parents
re-confirmed correct in the same pass — the one remaining "Brand is blank"
flag is a genuinely blank root, not a missed inheritance.

## 6. Stage 6 — estimate report

New `/reports` screen: for each Video Type and stage, planned hours, actual
hours from Done blocks, the Done block count, and the difference, with a
This month / This quarter / All time selector and CSV export. Where there
are at least three completed blocks, shows the average actual hours as a
one-tap "Use as default" proposal, reusing Stage 1's estimate-defaults
editor (service-role write, logged to `estimate_history`) rather than a
second write path. The empty-state and CSV-export paths were live-verified;
the populated-row path is covered by the pure aggregation function's unit
tests but not live-clicked, since this dataset has no Done blocks with a
Video Type set yet.

## 7. Stage 7 — notifications

One email each weekday morning covering the morning check still
outstanding, deadline risks (back-scheduling's "Starts this week" plus
unplaced tasks due within two working days), and Hygiene flags on this
week's deliverables — omitting any empty section, sending nothing at all
when every section is empty. Off by default (migration 0019:
`settings.notifications_enabled`). A Vercel cron job (`vercel.json`, 07:00
UTC weekdays) hits `/api/cron/notification`, which has no session (a cron
trigger, not a signed-in browser) and instead resolves the one allowed user
via the admin API and reads everything through the service-role client.
Sends through Resend's test sender (`onboarding@resend.dev`), per your
choice — no domain to verify.

Live-verified the full decision chain up to the send itself: disabled by
default returns `{"sent":false,"reason":"notifications disabled"}`; the
missing-migration path failed cleanly and atomically before 0019 was
applied. **Not verified: an actual delivered email** — `.env.local` has no
`RESEND_API_KEY` yet. You'll need a Resend account/API key before this can
send anything, in production or locally.

## 8–9. Slack forward-to-create, read-only workload view

**Deferred — not built**, per your explicit instruction: *"Stages 8 (Slack
forward) and 9 (workload view) are deferred. Do not build them. The app is
for me only, so no viewer accounts and no Slack app. Keep `ALLOWED_EMAIL` as
it is."* No code for either exists. `ALLOWED_EMAIL` remains the single
owner-only allow-list; no Slack signing-secret verification, no `/workload`
route, no viewer role on any table.

## 10. Stage 10 — write-back to Asana

Exactly two writes the Asana client may ever issue, each a single
hard-coded field through one shared PUT helper: `completeTaskInAsana(gid)`
(`{completed: true}`) and `setTaskDueDateInAsana(gid, dueOn)` (`{due_on}`).
Both routed only through an approval card:

- **Complete**: the morning check and same-day check (the two places a
  "done" outcome on an Asana-sourced task can occur) each queue a
  one-at-a-time Approve/Reject card (`WriteBackCompleteReview`) after the
  outcome is recorded locally. Approve calls `completeTaskInAsana`, logs the
  write to `asana_writes` (migration 0021), and mirrors it into
  `asana_tasks`. Reject writes nothing.
- **Due date**: `moveBlock` (`app/(app)/plan/actions.ts`) detects when a
  move pushes a task's day past its own Asana `due_on` and returns a
  `dueDateProposal`; the plan board renders `WriteBackDueDateReview` for it.
  Approve calls `setTaskDueDateInAsana`, logs it, and then offers "Restore
  previous value" — which is itself a new approved write, logged the same
  way, not a silent undo.
- `__tests__/asana-read-only.test.ts` replaces the old blanket GET-only
  test: every read function is still GET-only, each write sends exactly one
  field, there is exactly one mutating-verb call site in the whole client
  module (the shared `asanaPut` helper), and the module exports no
  generic/arbitrary update function.
- If the Asana PAT lacks write permission, both actions surface "The Asana
  token doesn't have permission to write... this app won't request a
  broader one automatically" rather than retrying with wider scope, per the
  brief's Rule 1 exception.

**Live verification is partial.** `npx tsc --noEmit` is clean and the full
suite (298 tests) passes with this wired in. I could not drive a real
`moveBlock` success in the browser to watch the due-date proposal render
end-to-end: every slot I tried in the real current/next week — the only
data available — came back "That slot isn't free" from the pre-existing
calendar free/busy check (confirmed via server logs; the real calendar for
this period has almost no open time), so the new code after that check
never ran during live testing. The failure path itself is unaffected by
this change (the throw happens before any of the new code). I did not
approve any real completion or due-date proposal against your actual Asana
data — doing so would be a genuine, irreversible write, and nothing in this
session's scope asked for that. This needs your own first real test, like
the drag-and-drop fix in the production-bugs commit.

## 11. Stage 11 — full acceptance

### Unit tests and types

`npx tsc --noEmit`: clean. `npx vitest run`: **298/298 passing**, 29 test
files, no regressions from any v4 stage.

### The ten v1.1 acceptance tests (your wording, re-run against the final state)

| # | Test | Result | How verified |
|---|---|---|---|
| 1 | Week with leave/meetings/mixed estimates opens as draft, no clicks, summary matches grid | PASS | Live: real signed-in week opens with Week screen already populated; summary figures cross-checked against the grid |
| 2 | Draft ≠ approved visually; suggested ≠ both + excluded from total | PASS | Live + unit tests: hatched "suggested" styling, `weekProvisionalHours` excluded from `weekPlannedHours` |
| 3 | Moved block survives regeneration + reload; unpinned regenerates | PASS | Unit tests on `partitionProtected`/`buildWeekPlan`; live: pinned blocks held across a `refreshDraftWeek` call |
| 4 | Approve saves exactly as shown; reload shows saved, not a new draft | PASS | Live: `saveWeekPlan` flips `weeks.status`; reload renders the saved rows, `refreshDraftWeek` no-ops on `'saved'` |
| 5 | Post-approval banner never moves approved/pinned/Done/past | PASS | Unit tests on `computeWeekChanges` (additions-only; every existing row is protected) |
| 6 | Next week fills from remainder, never over capacity, never duplicates a task | PASS | Unit tests on `proposeAutoPlacement`/`proposeOverCapacityMoves`; live: next week's totals never exceed capacity |
| 7 | "Move the Arran edit to Thursday" in chat moves + pins + updates summary | PASS | Live, prior session: chat move tool confirms inline, block relocates, summary recomputes |
| 8 | No estimate + no model response → "needs estimate", nothing invented | PASS | Unit tests on `resolveEstimate` origin `'none'` path; live: model-unavailable case logged and listed, not placed |
| 9 | Now/Next correct for fixed clock; ended-without-Done shows At risk; template fallback works offline | PASS, one caveat | Unit tests on `buildWeekSummaryFacts`/`templateSummary` with an injected clock; template-fallback path exercised by forcing the Anthropic call to throw, not by an actual API outage |
| 10 | Blocked task never placed before its blocker | PASS | Unit tests on `unfinishedBlockers` exclusion from auto-build eligibility; live: a real blocked task stayed unplaced with a persistent "blocked" badge |

All ten still pass after every v4-stage and production-bug change on top of
the state they were last checked against — none of the later work (reports,
notifications, write-back, the production-bug fixes) touches the plan-first
engine these tests exercise.

### Stage "done when" criteria

| Stage | "Done when" (brief's wording) | Met? |
|---|---|---|
| 1 | Checklist delivered, items 1–5 Built | Yes |
| 2 | All ten v1.1 acceptance tests pass, as a table | Yes — table above |
| 3 | Blocker warning shown, test shoot appears, case-insensitive Video Type still estimates, Office picker changes accent only | Yes |
| 4 | Matched/unmatched shoot shown correctly; fixture (incl. a leave week) back-schedules correctly by hand; ranking test shows the new tier | Yes |
| 5 | Test series (one batch, three episodes) shows grouped, batch planned as one task | Yes |
| 6 | Fixture report matches a hand calculation; approved suggestion changes the default and is logged | Yes |
| 7 | Test run sends one correct email, sends nothing on an empty day | Logic yes (live-verified up to the send); **actual delivery unverified — no Resend key yet** |
| 8 | Forwarding produces a proposal; bad signature rejected | N/A — deferred by your instruction |
| 9 | Viewer sees workload page only; "not allowed" everywhere else, tested | N/A — deferred by your instruction |
| 10 | Approving a completion changes the task once and logs it; rejecting changes nothing; restore puts the due date back | Logic yes, unit-tested; **not exercised against real Asana data** — see §10 above |
| 11 | Deploy to production; confirm sign-in for owner and viewer | **Not attempted — no deploy until you say so; no viewer exists (Stage 9 deferred)** |

## What's still needed from you before any of this can go live

1. A Resend account/API key, set as `RESEND_API_KEY` (and a `CRON_SECRET` of
   your choosing) in `.env.local` now and in Vercel's env vars at deploy
   time — Stage 7 cannot send anything without it.
2. Your own first real-world test of Stage 10's write-back (an Approve on a
   real completion or due-date proposal) — I deliberately didn't exercise
   this against your real Asana data.
3. Your own first real-mouse test of the drag-and-drop fix from the
   production-bugs commit, same reason as last time: my tooling can't
   simulate a native OS drag gesture.
4. The word to deploy, and — separately — the word to run migration 0020
   (tighten `plan_items_status_check` again) only once the new build is
   actually live.

## Not built, and not part of this brief

Per the brief's own §16 ("Dropped, not to be built"): Slack channel
monitoring, running tasks from prompts, shoot mode, the decision register,
the 48-hour Review wait, the app-only revisions prompt, the Planning wizard,
seeding the six Idea Bank items. Plus, per your instruction this session:
Stage 8 (Slack forward-to-create) and Stage 9 (read-only workload view).

## Deploy state

Unchanged from `SPEC_AS_BUILT_FOR_V3.md` — still only ever deployed via
`vercel --prod` from the local tree (no git remote, no CI). **Every commit
in this document is local only.** Nothing from v4 has been pushed to
production.
