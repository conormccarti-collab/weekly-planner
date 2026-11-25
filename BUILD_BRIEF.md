# Putting the Ass in Assistant (working title): build brief

Version 1.2, 16 November 2026. Written for Claude Code. This file is the single source of truth for the build. It replaces the earlier "V1 Product Specification" and the "Northstar" HTML mockup, which are reference only.

## 1. What this is

A personal web app for one user (Conor, a video lead who shoots, edits and plans). Its one job is to produce a **realistic weekly plan**: what fits in the week, placed on days, given real tasks and real calendar commitments.

It reads tasks from Asana and events from Google Calendar, combines them with a to-do list typed in on Monday, and compares hours of work against hours available.

It is used mostly on desktop: a planning session on the first desk day of the week, then a short check each morning. It must stay usable on a phone, but phone-first features are out of scope.

## 2. Rules that override everything else

1. **Read-only to the outside world.** The app never creates, edits, completes or deletes anything in Asana, Google Calendar or Slack. The Asana client may only issue GET requests. The Google scope is `calendar.readonly`. Add a test that fails if any non-GET Asana call exists.
2. **Arithmetic is code.** All hours, capacity, totals and scheduling are computed by ordinary, unit-tested code. The language model is only used to read free text, suggest estimates and explain results. It never produces a number that the app displays as a calculated total.
3. **Nothing is invented.** The app never shows a deadline, estimate, priority or completion that did not come from Asana, the calendar or the user. Anything suggested by the model is labelled "suggested" until the user confirms it.
4. **Changes are proposed, then approved.** Any change to the plan that the user did not make by hand (auto-placement, replanning, chat requests) is shown as a proposal with Approve and Reject. Nothing is applied silently.
5. **Every task shows its source** (Asana or Personal) and Asana data shows when it was last synced. If a sync fails, show stale data with its age and say so.
6. **Stay inside this brief.** Do not add features, screens or integrations that are not listed for the release being built. If something is ambiguous, ask before building.

## 3. Stack

- Next.js (App Router) with TypeScript, deployed on Vercel.
- Supabase: Postgres and Auth. Row-level security on every table. The service-role key is used server-side only.
- Sign-in: Google sign-in through Supabase Auth, restricted to one address held in `ALLOWED_EMAIL`. Any other account is rejected.
- Use one Google consent for both sign-in and calendar access, requesting `calendar.readonly` with offline access. `ALLOWED_EMAIL` must therefore be the Google account that owns the work calendar.
- Google Cloud setup matters: a consent screen left in "Testing" issues refresh tokens that expire after 7 days. Set the app up as Internal to the work Google Workspace if that is possible, otherwise publish it to "In production". Detect an expired or revoked token and show a "Reconnect calendar" prompt instead of silently using stale events.
- Asana: personal access token in `ASANA_PAT`, workspace in `ASANA_WORKSPACE_GID`. Server-side only.
- Google Calendar: OAuth with offline access, refresh token stored encrypted in Supabase.
- Language model: Anthropic API, key in `ANTHROPIC_API_KEY`, model name in `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`). Use tool calling with strict JSON schemas for every structured output.
- Time zone from `APP_TIMEZONE` (default `Europe/London`). All dates are local dates in that zone.
- No secrets in the repo. Provide `.env.example`.

## 4. Data model

Create these tables with migrations. Names can be adjusted, the content cannot.

| Table | Purpose | Key fields |
|---|---|---|
| `settings` | One row of user settings | working days, hours per day, default start time per weekday, lunch, planning percentage, minimum deep-work block, time zone |
| `day_starts` | Actual start time recorded for a day | date, start time, whether the user corrected it |
| `asana_tasks` | Cache of tasks assigned to the user | gid, name, parent gid and name, project and section memberships, due and start dates, completed, custom fields (by name), subtask count, permalink, Asana modified time, last synced, no longer assigned |
| `asana_projects` | Projects the cached tasks belong to | gid, name, free-text notes written in the app |
| `personal_tasks` | Tasks that live only in the app | title, notes, due date, hard deadline flag, priority, status (open, done, dropped), origin (monday list, chat, slack) |
| `task_meta` | App-only data about any task | source and reference, stage, focus type (deep or shallow), estimate hours, remaining hours, estimate origin (template, suggested, user, learned), priority override, parked flag |
| `estimate_defaults` | Default hours per content type and stage | content type, stage, hours, focus type |
| `estimate_history` | Every change to an estimate | task reference, task type key, old hours, new hours, changed at |
| `weeks` | One row per planned week | week start, status (draft, saved), capacity snapshot, saved at |
| `plan_items` | A task planned in a week | week, task reference, must flag, day (nullable), hours, position, status (planned, done, behind, moved) |
| `calendar_events` | Cache of calendar events | id, start, end, all-day flag, shown as free or busy, response status, title, last synced |
| `ideas` | Follow-up list of ideas | text, created at, status (open, converted, dropped), converted task |
| `chat_messages` | Chat history and proposals | role, content, proposed actions (JSON), action status |
| `sync_log` | Result of each sync | source, started, finished, ok, error |

A task appears once in the app however many Asana projects it sits in. Identity is the Asana gid.

## 5. Asana sync

- Fetch all incomplete tasks assigned to the user in the workspace, including subtasks. Also fetch tasks completed in the last 14 days so the app can close plan items.
- For each subtask, fetch its parent to read the parent's name, projects, sections and custom fields. Subtasks do not carry these themselves.
- Match custom fields **by name**, not gid. The workspace has more than one field called "Priority" (High, Medium, Low). Brand and Content Type fields will exist on newer tasks and be absent on older ones.
- Sync when the app opens, on a Refresh button, and every 15 minutes while it is open. Show "last synced" on every screen that shows Asana data.
- A task that is no longer assigned to the user is marked, removed from future plans, and kept for history.
- The user can **park** any task in the app, which hides it from planning without touching Asana.

### Parents and subtasks

Without these rules, hours are double-counted or work goes missing.

- A task that has subtasks is a **container**. It is never planned or estimated itself. Its hours are the sum of its plannable subtasks.
- For every container assigned to the user, fetch its subtasks, to a depth of three levels.
- An **unassigned** subtask under a container the user owns is treated as the user's work and is plannable. Much of the existing data is like this.
- A subtask assigned to someone else is shown for context under the container and is never planned.
- A subtask assigned to the user under someone else's container is planned as normal.
- A container the user owns with nothing left to plan is shown as "nothing left to plan, check in Asana".

### Stages

A stage is detected from the subtask name, ignoring case, spacing and small spelling differences (existing data includes "Planning &Pre-Production", "Planning & Pre Production" and "Pre-Edit Revire & Brief").

| Stage | Focus type |
|---|---|
| Ideation | shallow |
| Planning & Pre-Production | shallow |
| Shoot | away from desk: shown, but 0 desk hours in every release |
| Script | deep |
| Pre-Edit Review & Brief | deep |
| Edit | deep |
| Review | waiting on others, or shallow when the user is the reviewer |
| Publish | shallow |

Review has two forms. When the user is the editor, it is a 48-hour wait for the team's feedback and takes no desk hours. When the user is reviewing someone else's edit, it is a short shallow task.

A task with no recognised stage is a plain task with focus type shallow, which the user can change.

## 6. Estimates

Unit is hours. One working day is 7 hours.

Order of precedence for a task's estimate:

1. The user's own figure for that task.
2. A figure the user previously gave a task of the same type (same content type and stage, or a close name match). Shown as "from your earlier entry".
3. The default for content type and stage, from `estimate_defaults`.
4. A model suggestion, shown as "suggested" and not counted in totals until confirmed.
5. No estimate: the task is listed as "needs estimate" and excluded from totals with a visible count.

The app only asks for an estimate when a task is added to a week. It never asks the user to estimate the whole backlog. The first sync will bring in around 50 tasks, and most will sit unestimated in the full list until they are needed.

Seed `estimate_defaults` with these figures from the 2027 Production & Capacity Plan:

| Content type | Stage | Hours |
|---|---|---|
| Narrative (Nurture or Conversion) | Planning & Pre-Production, producing | 14 |
| Narrative | Planning & Pre-Production, overseeing only | 3.5 |
| Any | Pre-Edit Review & Brief | 2 (the user's range is 1 to 2, by shoot and edit complexity) |
| Narrative | Edit | 28 |
| Narrative | Review, user is the editor | 0 hours, with a 48-hour wait |
| Narrative | Revisions after feedback | 7 |
| Discovery batch (release 2) | Pre-production | 21 |
| Discovery batch (release 2) | Edit | 35 |
| Discovery batch (release 2) | Revisions | 7 |

Script, Ideation and Publish have no default. The app asks the first time and remembers the answer. The same applies to a Review where the user is reviewing someone else's edit.

How Review works when the user is the editor:

- When the Edit is marked done, Review becomes a plan item of 0 hours that lasts two working days. Nothing else from the same deliverable is placed before it ends.
- There is no Revisions subtask in Asana. When the wait ends, or the user says feedback has arrived, the app asks how many hours of revisions are needed, offering 7 as the default, and adds them to the plan as an app-only item linked to the deliverable.
- In release 2, back-scheduling counts the two-day wait in the timeline.

Every change to an estimate is written to `estimate_history`.

## 7. Capacity

- Working pattern comes from `settings`: Monday to Friday, 7 hours a day plus an hour for lunch. All of this is editable, so a four-day week can be switched on later without code changes.
- The start time varies. Defaults are 09:30 on Monday and 08:30 Tuesday to Friday, each editable per weekday. These defaults are used for any day that has not started yet.
- On the day itself, the first time the app is opened sets that day's actual start, rounded to the nearest 15 minutes. Show it with a one-tap correction ("Started 08:30. Change"). Store it in `day_starts`.
- Only record a start when the app is first opened between 07:00 and 11:00 on a day with capacity. Opening it in the evening, at a weekend or on a leave day records nothing, and a first open after 11:00 uses the weekday default.
- Lunch is a one-hour block at a default time of 12:30 (a setting). It is never used for placement. An event during lunch still counts as busy time.
- The day runs from its start time for 8 hours (7 working plus lunch). Free blocks for that day are recalculated from the actual start.
- The start time changes where the free blocks fall. It does not change the 7-hour total.
- Read events from the user's primary Google Calendar. An event reduces capacity unless it is declined or marked "free".
- Overlapping events count once.
- An all-day event marked busy (leave, shoot, travel) sets that day's capacity to zero.
- Day capacity = hours per day minus busy hours inside that day's window, never below zero.
- Planned capacity = day capacity multiplied by the planning percentage (default 100%).
- Also compute the **free blocks** in each day (start, end, length). These drive placement of deep work.
- No confidence scores and no ranges. Show one figure per day and one per week, with the events that produced it one click away.

## 8. Screens

1. **Week** (home). Five day columns with capacity, planned hours and hours left for each. A side list of this week's unplaced tasks and a collapsed list of everything else. Each task shows name, parent, source, due date, priority, estimate and a Must toggle. Drag a task to a day, or split it across days by entering hours. Week total against week capacity is always visible, with a clear over-capacity state. A task is in "this week" if it is due this week or overdue, was left unfinished in last week's saved plan, is flagged Must, or was pulled in by the user. Everything else stays in the full list, grouped by project and searchable.
2. **Planning session.** A guided, skippable run-through for the first desk day of the week: review what synced, type the Monday list in chat, confirm proposed tasks and estimates, flag Musts, place the week, save the plan.
3. **Projects.** One page per Asana project that holds the user's tasks: the tasks, their planned hours this week, and a free-text notes box. No decision register.
4. **Ideas.** A simple dated list. An idea can be turned into a personal task or dropped.
5. **Settings.** Working pattern, planning percentage, deep-work block length, estimate defaults, connections and their status.
6. **Chat.** A button on every screen opens a pop-up panel. It is not a separate page.

Design: desktop-first, calm and dense enough to see a whole week without scrolling. On a phone the day columns stack. No drag-only interactions: every drag has a tap alternative.

## 9. Chat

The chat is the main way in. In every case the model returns structured proposals and the app shows them for approval.

- **Monday list.** The user pastes or types a list of non-Asana tasks. The model splits it into proposed personal tasks. For each one the app asks for anything missing: estimate, priority, deadline. Code supplies likely matches from existing Asana and personal tasks. A clear match is linked instead of duplicated, an unclear one is asked about. Nothing is created until the user confirms the batch.
- **Ideas.** "Idea: ..." or anything the model classes as an idea goes to the ideas list after confirmation.
- **Questions.** "What's at risk this week?" is answered from tasks, plan and capacity already computed by code.
- **Plan changes** (release 1.1). "Move the Arran edit to Thursday" becomes a proposed change.
- **Priority overrides** (release 1.1). "The Brian edit matters less than its date suggests" sets a priority override in `task_meta`. Asana is not changed.

Carrying out work from a prompt is not in scope.

## 10. Releases

Build one stage at a time. Stop after each stage, show what was built, and wait for review.

### Release 1: testing from Monday 23 November 2026

It runs against Asana as it is today, where most tasks have no Content Type and estimates are mostly entered by hand.

Stages 1 to 5 on their own are a usable manual planner. If time runs short before the 23rd, ship those and add stages 6 and 7 the following week, with personal tasks added through a plain form in the meantime.

| Stage | Build | Done when |
|---|---|---|
| 1 | App shell, sign-in, settings, empty screens | Only the allowed address can sign in; settings save |
| 2 | Asana sync, task list, park, source labels, last synced | Every open task assigned to the user appears once; a subtask shows its parent and project; a task in two projects appears once; a container and its subtasks are never both counted; an unassigned subtask under the user's container is plannable; no non-GET call exists |
| 3 | Calendar sync and capacity | Capacity per day matches a hand calculation for a week with overlapping events, a declined event, a "free" event and an all-day busy event; opening the app at 09:40 on a Monday records a 09:45 start and moves that day's free blocks |
| 4 | Estimates, stage detection, estimate history | Precedence in section 6 holds; totals exclude unconfirmed suggestions; misspelt stage names are recognised |
| 5 | Week screen with manual placement and Must flag | Dragging or entering hours updates day and week totals; over-capacity is obvious; a saved plan reloads exactly |
| 6 | Chat pop-up: Monday list, ideas, questions | A ten-line list becomes ten proposals; a line matching an existing task is linked, not duplicated; nothing is created before confirmation |
| 7 | Planning session, Projects and Ideas screens | A full session can be completed from sync to saved plan |

Seed the ideas list with these six entries, which currently sit in Asana's Idea Bank:

- SCOTLAND: YouTube Discovery series, "Highland Education"
- SCOTLAND: YouTube Nurture, Achpopui farm
- Drystone Walling
- Carbon Negative Vineyard, Scilly
- Bee lady in Cork
- CROSS BRAND: Kit Stories

Launch step for the user: once these are in the app, remove them from Asana by hand.

### Release 1.1: the two weeks after

- **Automatic placement.** Order tasks by: Must, then hard deadline, then priority (override before Asana), then due date. Deep work goes into the longest free blocks first. Shorter tasks fill the gaps. Deep work may use a gap of one hour or more only when no shallow task is left, and never a gap under one hour. Stages of the same deliverable keep their order. Shown as a proposal.
- **Over capacity.** Propose which tasks move to next week, lowest-ranked first, never a Must.
- **Morning check.** For each task planned on the previous desk day: Done, On track, or Behind. Behind asks for hours left. Tasks completed in Asana close themselves. Days with zero capacity are skipped, and missed mornings are caught up in one step. The rest of the week is then re-placed and shown as a proposal.
- **Chat plan changes and priority overrides.**
- **Copy this week's plan** as plain text for pasting into Slack.

### Release 2: January 2027

- Estimates from Content Type and stage on tasks built from the new Asana templates.
- Back-scheduling: from the publish date on a deliverable, work out the latest start of each stage and warn when one must start this week.
- Shoots: a Shoot subtask is matched to the calendar event on its due date and takes no desk hours.
- Discovery batches planned as one batch task, with light per-episode tasks for review and publish.
- Notifications for the morning check and deadline risks.
- Estimate report: planned against revised hours by task type, for the end-of-Q1 capacity review.
- In-app reminders: check off an Asana task for real after marking it done in-app; follow up on a subtask you don't own when its parent task is yours.

### Not planned

Slack (beyond copying plan text), a colleague workload view, write-back to Asana, carrying out tasks from prompts, a decision register, shoot mode, team management features.

## 11. Testing

- Unit tests for capacity, free blocks, estimate precedence and placement, using fixed fixtures.
- Fixture weeks must include: overlapping meetings, a declined meeting, a "free" event, an all-day busy day, a week with no desk days, and a task longer than the week.
- A test that asserts the Asana client cannot issue anything but GET.
- Each stage's "done when" column is the acceptance test. Demonstrate it before moving on.

## 12. Open items for the user

The five items from version 1.0 (name, Review, Pre-Edit Review & Brief hours, model, start times) were settled on 16 November and are written into the sections above.

Sign-in uses the user's work Google account, which holds the work calendar. `ALLOWED_EMAIL` is that address.

One thing to check before stage 1:

1. Whether the user can create a Google Cloud project inside the work Google Workspace. If yes, create it there and set the consent screen to Internal. If project creation is blocked, create the project under a personal Google account as External, publish it to "In production", and expect an "unverified app" warning at the first sign-in. If the Workspace blocks unapproved apps from reading Calendar, an admin has to allow the app.

Three assumptions remain that the user has not confirmed. All are settings or easy to change:

1. Lunch is one hour at 12:30.
2. The 48-hour review wait is counted as two working days, so a wait that starts on Friday ends on Tuesday.
3. Unassigned subtasks under a task the user owns are treated as the user's work.
