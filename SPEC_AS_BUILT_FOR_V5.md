# Weekly Planner — as-built spec for v5 (through the write-back/reminders pivot)

Written 2026-11-25. Covers everything built on top of `SPEC_AS_BUILT_FOR_V4.md`
from `~/Desktop/work-assistant-brief-v5-smart-assistant.md` (v1.0, 20 November
2026, Stages 12–21) — none of which had been written up before this document,
despite most of Stage 12 and part of Stage 14 already being built. This
document also captures a scope change made directly by Conor mid-stream,
superseding parts of Stages 9, 10, 17 and 20 below.

**Git note.** This repo does have a GitHub remote
(`github.com/conormccarti-collab/weekly-planner`) — Stage 12a.1 is done — but
had no commits since 2026-11-21 despite everything below landing locally in
the meantime. Caught up in one commit (`b5c191e`) at the end of this session;
not yet pushed (no GitHub credentials available in this environment — you'll
need to `git push origin main` yourself).

## Scope change: write-back dropped, reminders added instead

Mid-session, independent of the v5 brief, Conor said: *"We're dropping slack
entirely. We can drop the colleague workload thing too. I don't want any
write back functionality. I just want a way to be organised during the week
and helpful reminders... I want an app that I can talk to and that will
remind me of things I need to do like a personal assistant."* Followed up
with "in-app only" for how reminders should reach him — no email, and chat
never raises them unprompted.

This **supersedes** the v5 brief in three places:
- **Stage 20** (hygiene fixes through write-back) is now dropped outright,
  not just "needs a yes" — and v4 Stage 10's original two write actions
  (complete a task, change its due date) were removed too. The Asana client
  is GET-only again, same as before Stage 10 ever existed.
- **Stage 17a** (read-only team/colleague view) and the already-deferred
  Stage 9 are both off the table — no colleague visibility of any kind.
- **Stage 16**'s proactive-assistant vision (email/push nudges) is not
  dropped, but narrowed for now: Conor asked to hold off on email until
  "everything is 100%", and chose reminders delivered in-app only rather than
  by email or push.

## Stage-by-stage status

| Stage | Status |
|---|---|
| 12. Foundations and live fixes | Built, with real gaps — see §1 |
| 13. Planning intelligence | **Not built** |
| 14. Rules, context and the chat upgrade | Partially built — see §2 |
| 15. Facelift (design canvas) | **Not built** — design canvas exists, unused |
| 16. The proactive assistant | **Not built** (superseded in part — see above) |
| 17. Awareness (team, reviews, commitments, runway) | **Not built**; 17a superseded (dropped) |
| 18. The learning loop | **Not built** |
| 19. Capture anywhere | **Not built** |
| 20. Hygiene fixes through write-back | **Not built — now superseded (dropped), not just deferred** |
| 21. Acceptance and final deploy | Not attempted — most of 13–20 isn't built yet |
| — Write-back removal + in-app reminders | Built this session — see §3 |
| — Daily summary moved into chat | Built this session — see §4 |

## 1. Stage 12 — foundations and live fixes

**12a. Engineering safety — partial.**
- 12a.1 (private GitHub repo + Vercel git integration): the repo and remote
  exist. Vercel's git integration itself wasn't verified this session.
- 12a.2 (migrations applied by tooling, not pasted by hand): **not done** —
  migrations 0025–0028 all still needed pasting into the Supabase SQL editor
  by hand this session, same as before.
- 12a.3 (Supabase backup retention confirmed): not addressed.
- 12a.4 (CI on every push): `.github/workflows/ci.yml` runs typecheck + unit
  tests on every push/PR. The e2e job exists but is gated behind an
  `E2E_READY` repo variable that's off — Playwright is blocked on a sign-in
  method decision (`__tests__/e2e/README.md`), so e2e doesn't actually run
  in CI yet.
- 12a.5 (error logging + a "problems" count in Settings): built
  (`instrumentation.ts`, `instrumentation-client.ts`).
- 12a.6 (`/api/health`): built.

**12b. Playwright with a real pointer — partial.** `playwright.config.ts` and
fixtures exist; `edit-and-place-modals.spec.ts`, `reject-undo.spec.ts`, and
`zero-writes-on-load.spec.ts` are written, covering the editor, reject+undo,
and the "loading the Week screen writes nothing" assertion. A prior
`drag-and-resize.spec.ts` was deleted (uncommitted, before this session) with
nothing replacing its coverage — real-pointer drag/resize is not currently
tested. Not run in CI (see 12a.4).

**12c. Stop writing on read — built.** `weeks.input_hash` (migration 0022);
`refreshDraftWeek` is event-triggered, not page-load-triggered.

**12d. Eligibility gate — built.** `settings.planned_project_gids`
(migration 0023) scopes planning to Visual Content Pipeline, Production &
Shoots, and personal tasks; everything else lists under "Outside the
workflow" without being placed, counted, or flagged. Stale-task handling
(`lib/stale.ts`, 14-day cutoff) is built and tested.

**12e. Live bugs from testing — built.** Reject records to `plan_events`,
offers Undo, and regeneration doesn't re-propose the same slot
(`avoidSlotByKey`). Drag updates local state with a single save on drop.
Block editor defaults hours correctly. Brand/Video Type inheritance from
parent fixed (a subtask's own explicit `null` no longer overwrites the
parent's real value). Parent names show on every subtask.

**12f. Summary rewrite — built, then superseded this session.** The
structured-card rewrite (bold label per section, short dates, correct
overdue wording, merged duplicates, zero-capacity explanations) was built as
a standalone card. This session moved that same card's facts into the chat
instead (§4) — the underlying `lib/summary.ts` facts are unchanged, only the
presentation moved.

**12g. Insert-and-push, splitting, break settings — built.**
`lib/resolve-drop.ts` is the real engine behind both live drag-preview and
the actual drop: redirects to the nearest free slot, ripples non-pinned
blocks forward, or splits across a day boundary, always returning an
accurate `summary` string. Splitting (`lib/split.ts`), a configurable
minimum split-part size, and a lunch/break setting (fixed or flexible mode,
migration 0025) are all built.

## 2. Stage 14 — rules, context and the chat upgrade (partial)

**14a. Rules and context — partial.** Standing rules (migration 0027) can be
typed in Settings (`rules-actions.ts`: list/add/remove) and are parsed once
at creation (`lib/chat/claude.ts`'s `parseSchedulingRule`) into a structured
shape where possible, falling back to `freeform` (chat-context only, never
silently claimed as enforced) otherwise. **Not built**: adding a rule from
chat itself (no `propose_add_rule` tool — Settings only), an on/off switch
per rule, a per-rule "how many blocks affected this week" count, and
conflict reporting between rules.

**14b. Chat upgrade — partial.**
- Built: real multi-turn memory (full history threaded into every model
  call, not just the latest message); the model can reply in plain text
  instead of always forcing a tool call; a feasibility/conflict check before
  adding something that won't fit or lands on a day already known to be
  blocked; honest "didn't land as requested" messaging when a drop redirects
  instead of landing exactly where asked; "take time off" via chat (this
  session's `propose_day_lock` — lock or unlock a day, with a reason);
  structured replies — chat renders real markdown (bold, bullets, headings)
  instead of showing raw symbols or one run-on paragraph (this session's
  `components/chat-markdown.tsx`), which satisfies the brief's "no raw
  markdown symbols" intent by rendering them rather than avoiding them.
- Undo exists, but scoped per action type (`undoDrop` for a move/drop,
  `undoReject` for a reject) rather than the brief's broader "What changed
  since…" panel across every change type.
- **Not built**: "why is X on Thursday" explain, what-if ("what if Emma's
  edit slips two days?"), and ask-over-history ("hours spent on a film").

## 3. Write-back removal + in-app reminders (this session)

Per the scope change above: deleted `app/(app)/write-back/actions.ts` and
`components/write-back-review.tsx`; removed `completeTaskInAsana` /
`setTaskDueDateInAsana` and the shared `asanaPut` helper from
`lib/asana/client.ts` (GET-only again); removed the `dueDateProposal`
plumbing from `moveBlock`/`resolveAndApplyDrop`; cleaned the write-back UI
out of `week-list.tsx`, `same-day-check.tsx`, and `morning-check-panel.tsx`.
`__tests__/asana-read-only.test.ts` reverted to a single "every call is GET"
assertion. The `asana_writes` table (migration 0021) is left in place,
unused — dropping it is optional cleanup, not done.

New: migration 0028 (`reminders` table, RLS owner-only). `lib/reminders.ts`
hooks into every "marked done" site (`markDone`, `markDoneAndCloseGap`,
`markNotDone` for retraction, `submitMorningCheck`'s loop,
`submitSameDayCheck`) to create or retract an "Asana checkoff" reminder,
shown inline on the task's own row once it's done
(`components/week/entry-row.tsx`) rather than in a separate list, per
Conor's own feedback during testing. A second, unstored reminder type
("follow up") surfaces a subtask you don't own, due within two working days,
on a container task you do own — derived at read time from already-synced
Asana data (no sync changes needed), reusing the same "my gid" derivation
pattern (most frequent `assignee_gid` among top-level rows, since a handful
of top-level rows come from cached blocker tasks, not real ownership) and
the same two-working-day cutoff `lib/summary.ts`'s "at risk" section already
uses. Both reminder types are grounded into `lib/chat/context.ts` so chat can
answer if asked, but never pushes them unprompted, matching "in-app only."

**Live-verified**: a stale dev-server module cache briefly made the
checkoff reminder appear missing after an edit to `lib/reminders.ts`
(`ReferenceError: mostFrequentValue is not defined`) — not a real code bug;
confirmed via `tsc`, the test suite, and running the function directly
against live data, then fixed by restarting the dev server. The checkoff
tag, dismiss, retraction-on-undone, and the day-lock chat tool were all
exercised live against real data and confirmed working.

**One incident worth recording**: while live-testing the day-lock chat tool,
a `browser_batch` call omitted its `tabId` and landed on the user's own live
tab instead of a background test tab, actually locking a real date
(2026-11-30) with a fabricated reason ("Annual leave"). Caught immediately
and reverted directly in the database; the stray exchange remains visible in
the user's real chat history.

## 4. Daily summary moved into chat

Conor's preference, given directly: *"The blue box at the top, I think its
the update text, can we move it to below the week. or have it be presented
as the first chat message each day. I prefer that idea [the chat message]."*

`lib/summary.ts` gained `formatDailySummaryText(facts)`, rendering the same
`WeekSummaryFacts` the old `WeekSummary` card used, as markdown. It is
**not persisted** — `loadChatHistory` (now `loadChatHistory(dailySummaryText)`)
recomputes it fresh on every load and splices it in immediately before
today's first real message (or appends it, if there are none yet today),
using each message's `created_at` against local midnight. This keeps it
always current through the day, the same way the old card's 5-minute
auto-refresh did, without a migration or a "has today's summary been sent"
flag to maintain. `components/week-summary.tsx` was deleted.
`SameDayCheckList` (the done/behind/moved prompts the card used to nest) now
renders standalone on the Week page instead, since it's interactive and
doesn't belong inside a chat message. `SummaryAutoRefresh` moved to the page
level, since it benefited more than just this one card.

## 5. Not investigated this round

`lib/summary.ts`'s `templateSummary` function (a model-phrased prose
fallback, pre-dating Stage 12f's structured-card rewrite) has no remaining
caller anywhere in the app — only its own test file exercises it. Likely
dead code left over from before 12f, not touched this session since it
wasn't in scope.

## What's still needed from you

1. **Push `b5c191e`** — `git push origin main` from a terminal with your
   GitHub credentials. Nothing from this catch-up commit is on GitHub yet.
2. A decision on Stage 12a.2 — hand Code a Supabase access token or
   connection string if you want migrations applied by tooling instead of
   pasted by hand each time.
3. A decision on the Playwright sign-in method (`__tests__/e2e/README.md`)
   to unblock `E2E_READY` and get e2e tests actually running in CI.
4. Still outstanding from v4: a Resend API key for email notifications — on
   hold per your own instruction ("wait until everything is 100%").
5. A decision on whether you want the Stage 15 facelift pursued — the design
   canvas referenced in the brief already exists
   (`claude.ai/artifact/EZFmKcxTDeMsqYK4ii9a3c`): a cream/forest-green theme,
   Lato type, pill nav, a four-card status strip, an hour-ruled calendar grid
   with absolutely-positioned blocks (a different layout from today's
   list-based day cards), and a redesigned docked chat panel. This is a large
   change touching nearly every component — worth agreeing scope on before
   starting, separately from this document.

## Not built, and not part of this brief

Everything the v4 doc already listed as dropped, plus — per the scope change
above — Stage 20 (write-back-based hygiene fixes) and Stage 17a (team view),
both now dropped outright rather than deferred pending a decision.

## Deploy state

Unchanged from v4: still only ever deployed via `vercel --prod` from the
local tree. Nothing from v5 has been pushed to GitHub or deployed to
production.
