# Calendar-block Week view: proposal (draft, not yet built)

Replaces the current day-column/hours model on the Week screen with a visual
calendar: time blocks at 15-minute resolution, for the current week and the
following week. Written up before building anything, per your request.

## 1. Scope

- Two weeks shown: current week and the following week, same mechanics on
  both. ("This week"/"everything else" task-list logic is unaffected — it
  still governs which tasks are *candidates*; this changes how placement is
  *displayed and manipulated*, not which tasks qualify.)
- Replaces the hours-only placement model entirely (brief section 8's
  "entering hours" becomes "drag the block's edge to resize," below).

## 2. The grid

- Each working day is a column; time runs top-to-bottom in 15-minute rows.
- A day's visible range is its computed window from Stage 3: actual/default
  start time through 8 hours later (7 working + 1 lunch).
- Lunch is shown as a fixed grey band, not droppable.
- Any calendar-busy time (from Stage 3's calendar sync) is shown as a grey
  band, not droppable — blocks can only occupy computed **free blocks**.
- Non-working days are omitted from the grid (as today).

## 3. Placing and resizing a block

- Dragging an unplaced task onto the grid creates a block starting at the
  nearest 15-minute mark, with a default duration of its estimate (rounded
  to the nearest 15 minutes, minimum 15).
- A block's **edge** is draggable to resize in 15-minute steps.
- A block's **body** is draggable to move it (same day or a different day,
  including across the two visible weeks).
- A drop that would land outside a free block, or that doesn't fit in the
  remaining space of one, is rejected (the block snaps back).

## 4. Splitting

- Dragging task **B** onto the middle of an existing block belonging to task
  **A** splits A's block in two: the portion before the drop point and the
  portion after, both remaining as A. B is inserted into the gap between
  them.
- B's inserted duration is its own estimate (rounded to 15 minutes), **capped
  to whatever space A's block has at that point** — if B's estimate doesn't
  fit, B is placed at the maximum size that does, and the remainder of B's
  work stays unplaced for you to place elsewhere.
- Dropping onto the very edge of a block (not the middle) resizes/moves
  instead of splitting.

## 5. Merging

- If two blocks belonging to the **same task** end up adjacent on the same
  day (no gap between them — whether from a drag, a resize, or a split being
  undone), they combine into a single block automatically.
- This is a real data merge, not just a visual one: the two placement rows
  become one row with the combined duration.

## 6. Data model change

`plan_items.day` + `plan_items.hours` (today's model) is replaced by
`start_time` and `end_time` (both local time-of-day). `hours` becomes a
derived value (`end - start`), not stored directly. This is the one real
breaking change — existing placements would need a one-time migration
(interpreted as starting at the day's free-block start, in sequence).

## 7. What's unaffected

- The Dashboard (capacity total + stage breakdown) and the record keeper
  (Done + actual hours) work exactly as now — they just sum from
  `start_time`/`end_time` instead of `hours`.
- Must flag, Save plan, "reloads exactly," Park, Add-to-this-week: unchanged.

## 8. Decisions (settled 2026-11-18)

1. **Deep work and free-block length**: manual dragging is unrestricted — you
   can drag a deep-focus task into any free gap that physically fits,
   regardless of length. The 60-minute-minimum-gap rule only governs the
   *automatic* placement feature (Release 1.1, not yet built).
2. **Resizing changes the estimate**: resizing a block to a different
   duration becomes your confirmed estimate (tier 1) for that task, exactly
   as typing an hours value does today — it also feeds tier 2 ("from your
   earlier entry") for future similar tasks.
3. **Following week's grid**: shown using each weekday's *default* start
   time (never a recorded actual one, since that only ever exists for
   today) — a flat 7-working-hour day. Calendar-busy time still excludes
   from free blocks the same as this week.
4. **Mobile**: tapping an empty slot opens a small time-picker (start time +
   duration) instead of dragging.
5. **Final-block indicator** (new): across the two-week view, a task's
   chronologically last placed block — by day, then end time — is tagged
   "final," so you can see at a glance when a project's remaining scheduled
   work runs out.
