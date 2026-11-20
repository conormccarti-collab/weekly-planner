# Weekly Planner — as-built spec (for merging into Brief v2)

Written 2026-11-18, for handing to another Claude session to reconcile against
the original brief and produce a v2. This covers every stage actually built,
every deliberate deviation from the original brief, and everything still
open. The two source documents already in the repo —
`BUILD_BRIEF.md` (original v1.2) and the v1.3 revision notes folded into it —
remain the spec of record for anything not called out below as changed.

## 1. What's built and verified (Release 1, Stages 1–7, all done)

### Stage 1 — App shell
- Google sign-in restricted to one email (`ALLOWED_EMAIL`), enforced in
  `proxy.ts` (Next.js 16's renamed middleware) on every request.
- Settings screen: working days, per-day start/lunch times, hours per day,
  planning percentage, lunch length, minimum deep-work block, timezone.
  Persisted in `settings`.

### Stage 2 — Asana sync
- GET-only Asana client. Syncs the user's open, assigned tasks plus the
  **Visual Content Pipeline** and **Production & Shoots** projects (v1.3
  structure — see `lib/asana/projects.ts`).
- Subtasks inherit the parent's custom fields (Video Type, Brand, etc.) since
  Asana subtasks don't carry these themselves.
- Park/unpark, source labels, last-synced display, containers vs. plannable
  subtasks, Backlog section hidden by default (v1.3).

### Stage 3 — Calendar sync and capacity
- Google Calendar read-only sync. Capacity per day = hours/day minus busy
  calendar time inside the day's window; lunch is excluded from free blocks
  but not separately subtracted from the capacity figure.
- Actual day-start recording (07:00–11:00 window, rounds to 15 min).
- **Out-of-Office handling**: Google's `eventType: "outOfOffice"` uses timed
  fields even for a multi-day absence — detected and normalized to the same
  all-day-busy semantics as a real all-day event (`lib/calendar/classify.ts`
  → `isOutOfOffice` / `fullDaySpan`). Without this, a week of annual leave
  would have shown full capacity.

### Stage 4 — Estimates, stage detection, estimate history
- Five-tier estimate precedence: user > learned (from your own past entries
  for the same stage+Video Type) > default (from `estimate_defaults`) >
  suggested (not built) > none. Totals exclude anything not in the first
  three tiers.
- Fuzzy stage detection (Levenshtein, length-proportional threshold, plus a
  prefix rule for "Shoot N - <location>" names) against the v1.3 stage list:
  Creative Brief, Planning & Pre-Production, Shoot, Pre-Edit Review & Brief,
  Edit, Review, Revisions, Shorts, Publish, Archive.

### Stage 5 — Week screen with manual placement (superseded in UI by the
calendar redesign below, but the underlying rules are unchanged)
- A task is "this week" if due this week or overdue, left unfinished in last
  week's saved plan, flagged Must, or pulled in manually.
- Must flag, Park, Save plan (a saved plan reloads exactly — draft-only
  tasks are materialized into real rows before the status flips to saved).

### Unplanned addition, built mid-stream: Dashboard + record keeper
Requested directly by the user, outside the original brief, and scoped via
clarifying questions before building:
- **Dashboard** (`components/dashboard.tsx`): total capacity available this
  week, planned hours, over-capacity flag, and a stage-by-stage
  planned-vs-actual breakdown bar chart (`computeStageBreakdown` in
  `lib/plan.ts`).
- **Record keeper**: "Done" + actual-hours-taken per placed block, feeding
  the same planned-vs-actual breakdown. Not literal time-tracking — just
  planned vs. what you mark done.

### Calendar redesign (formalized first via `CALENDAR_REDESIGN_PROPOSAL.md`,
then built) — replaces the Stage 5 day-column/hours model entirely
- Visual calendar: 15-minute-resolution time blocks, not just a day + a
  total-hours figure. `plan_items` gained `start_time`/`end_time` columns
  (migration `0010`); `hours` stays as a kept-in-sync denormalized value.
- Two weeks shown side by side (current + following), same mechanics on
  both. The following week always uses each weekday's **default** start
  time (never an actual recorded one, since that only ever exists for
  today) — a flat 7-hour day.
- Drag a block's body to move it (same day, another day, or across weeks);
  drag an edge-equivalent (the inline editor's duration field) to resize.
  **Resizing a block's duration becomes your confirmed estimate** (tier 1),
  exactly like typing an hours value did in the old model.
- **Split**: dragging a different task onto the middle of an existing block
  splits it into before/after pieces and inserts the dragged task between
  them, capped to whatever room is left. Verified live.
- **Merge**: two blocks of the *same* task that end up adjacent on the same
  day combine into one row automatically, on every move/resize/split.
- **Final-block badge**: a task's chronologically last block across the
  two-week view (by day, then end time) is tagged "final."
- **Tap alternative to every drag** (brief's own rule, "no drag-only
  interactions"): a "Place…" picker on each unplaced task (day + 15-min
  start-time + duration selects) and a click-to-expand inline editor on
  every placed block (day/start/duration selects, Done + actual hours,
  Remove). Split has no tap equivalent — it's drag-only, a deliberate scope
  cut since it's inherently a two-object gesture.
- Deep-work-block-length restriction (settings' "minimum deep-work block")
  does **not** apply to manual drags — it's reserved for the not-yet-built
  automatic-placement feature.
- Manual placement and move/resize/split/merge/remove/mark-done all
  verified live against real Asana/Calendar data in this session; test data
  was cleaned up afterward.

### Stage 6 — Chat pop-up: Monday list, ideas, questions
- Floating "Chat" button on every screen (not a separate page), per brief.
  Chat history is in-memory only (resets when the panel is reopened) —
  nothing is persisted server-side; revisit this for v2 if cross-session
  history turns out to matter.
- Uses `claude-sonnet-5-5` (from `ANTHROPIC_MODEL` in `.env.local`) via the
  Anthropic TypeScript SDK, tool-use with `strict: true` schemas, one of
  exactly three tools per message: `propose_personal_tasks`,
  `propose_ideas`, `answer_question`.
- **Arithmetic/matching stays in code, never the model** (brief's core
  rule): the model only (a) splits free text into structured items for
  Monday-list/idea messages, pulling out any estimate/priority/deadline
  mentioned inline, and (b) phrases an answer from a pre-computed context
  block (today's date, this/next week's capacity, tasks due this week or
  overdue) — it never computes or invents a number. **Matching an existing
  task is done entirely in code** (`lib/chat/match.ts`, token-Jaccard
  similarity against existing Asana + personal task names) *before* the
  proposal reaches the user; the model is never asked to decide a match.
- Review-before-create: every Monday-list/idea proposal is shown as an
  editable batch (name/estimate/priority/due-date fields, and for
  Monday-list items, a dropdown to link to a candidate match instead of
  creating new) with an explicit Confirm button. Nothing is written to the
  database until confirmed. A linked item creates nothing — satisfies "a
  clear match is linked, not duplicated."
- New tables: `personal_tasks` (name, estimate_hours, priority, due_on,
  completed) and `ideas` (title, status: open/converted/dropped,
  converted_personal_task_id) — migration `0011`.
- Personal tasks are now first-class throughout the planner: they flow
  through the same "this week" / "everything else" / placement / Must /
  Park pipeline as Asana tasks (see `lib/week-view-data.ts`,
  `toPersonalPlannerTask` in `lib/planner-view.ts`). Required widening
  `parkedGids`/must/placement lookups from bare-Asana-gid keys to
  `${source}:${reference}` composite keys throughout.
- **Not yet live-verified** — a real sign-in session was needed to test an
  actual chat round-trip (real Anthropic API call) and this session's
  sign-in cookie expired before that could happen. Typechecks, unit tests,
  and lint are all clean; the three-mode classification, the matching
  logic, and the confirm-batch actions have not been exercised against the
  live app yet.

### Stage 7 — Planning session, Projects, Ideas screens
- **Ideas** (`/ideas`): dated list, newest first. Each open idea: "Turn into
  task" (inline form for estimate/priority/due, creates a `personal_tasks`
  row and marks the idea converted) or "Drop". Converted/dropped idea
  history collapses into a details section. Seeded with the six brief
  entries (SCOTLAND: YouTube Discovery series "Highland Education", SCOTLAND:
  YouTube Nurture Achpopui farm, Drystone Walling, Carbon Negative Vineyard
  Scilly, Bee lady in Cork, CROSS BRAND: Kit Stories) — **reminder: the user
  still needs to remove these six from Asana's Idea Bank by hand**, per the
  brief's launch step.
- **Projects** (`/projects` → `/projects/[name]`): one page per project
  (grouped by the same `preferredProjectName` logic used elsewhere, so
  Pipeline-project tasks collapse the same way as on the Week screen).
  Detail page: task list (name, parent, due date), total planned hours this
  week for that project, and a free-text notes box (`project_notes` table,
  migration `0011`). No decision register, per brief.
- **Planning session** (`/planning`): a guided, skippable checklist — not a
  reimplementation of the Week screen's UI, but a thin wrapper around the
  same `loadWeekViewData` loader: sync status, an "Open chat" button (fires
  a `window` CustomEvent the floating chat button listens for, so it opens
  from any screen), a Must-flag checklist across all of this week's tasks,
  a link to the Week page for the actual placement (drag-and-drop legitimately
  needs the visual grid — not reimplemented here), and a working Save-plan
  button. Every step has a "Skip to the Week page" escape hatch.
- **Not yet live-verified** for the same reason as Stage 6 (session expired
  before testing). Typecheck/tests/lint clean.

## 2. Data model additions beyond the original brief

| Table | Added in | Purpose |
|---|---|---|
| `plan_items.start_time` / `end_time` | migration `0010` | Calendar redesign — a placement is a time range, not just a day + hours total |
| `personal_tasks` | migration `0011` | Non-Asana tasks created via chat's Monday-list flow or from a converted idea |
| `ideas` | migration `0011` | The dated ideas list; `status` + `converted_personal_task_id` track its lifecycle |
| `project_notes` | migration `0011` | Per-project free-text notes for the Projects screen |

`lib/env.ts` gained `anthropicApiKey()` / `anthropicModel()` (reads
`ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL`, already staged in `.env.local`
before this session began).

## 3. Deliberate deviations / decisions worth folding into v2 explicitly

1. **Calendar redesign fully replaced the Stage 5 "drag or enter hours"
   model** described in the original brief's Week screen section. If v2
   restates the Week screen, it should describe the 15-minute block grid,
   not day-column totals.
2. **Dashboard + record keeper** are a real addition to brief section 8,
   not originally specified. Worth promoting into the v2 spec proper rather
   than leaving as an aside.
3. **Chat creates nothing without a code-side decision first.** The brief
   says "code supplies likely matches" — this was implemented as a strict
   two-phase split (model parses text → code matches by name similarity →
   user confirms), specifically so the model is never the one deciding a
   match. Worth stating explicitly in v2 as the intended chat architecture,
   since it's a reusable pattern for the Release 1.1 chat features too
   (plan changes, priority overrides).
4. **Split is drag-only**, with no tap equivalent — a scope cut from the
   brief's blanket "every drag has a tap alternative" rule, made because
   split is inherently a two-object gesture. Worth a one-line carve-out in
   v2 if that rule is restated.
5. **Chat history is not persisted.** Reopening the pop-up starts fresh.
   Fine for Release 1's three chat behaviors; may need revisiting once plan
   changes / priority overrides (Release 1.1) make multi-turn context more
   valuable.
6. **Planning session deliberately doesn't duplicate the placement UI** —
   it links out to the Week page for that one step rather than re-building
   a drag-and-drop surface twice. If v2 wants a fully self-contained guided
   session, that's a scope decision to make explicitly, not something to
   assume was already done.

## 4. Not yet built (still matches the brief's Release 1.1 / "not planned")

Nothing here has been started:
- **Automatic placement** (order by Must → hard deadline → priority override
  → due date; deep work into longest free blocks first; stage order
  preserved within a deliverable; shown as a proposal).
- **Over-capacity task-moves proposal** (lowest-ranked first, never a Must).
- **Morning check** (Done/On track/Behind per task from the previous desk
  day; Asana-completed tasks self-close; zero-capacity days skipped; missed
  mornings caught up in one step; re-places the rest of the week as a
  proposal).
- **Chat plan changes** ("Move the Arran edit to Thursday" as a proposed
  change) and **priority overrides** (`task_meta`, Asana untouched).
- Everything under the brief's "Not planned" section remains out of scope.

## 5. Immediate next step

Sign back in to verify Stage 6 (a real chat round-trip through the Anthropic
API: Monday list → review → confirm; an idea capture; a capacity question)
and Stage 7 (Ideas convert/drop, Projects detail page, Planning session
checklist) against live data — none of this has been exercised in the
running app yet, only typechecked/unit-tested/linted.
