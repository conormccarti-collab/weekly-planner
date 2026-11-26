-- Nudge when a task from a project never seen before lands outside the
-- planned-projects workflow, so it doesn't sit unnoticed in a collapsed
-- section. Widens the reminders.kind check added in migration 0028.

alter table public.reminders drop constraint if exists reminders_kind_check;
alter table public.reminders add constraint reminders_kind_check
  check (kind in ('asana_checkoff', 'new_outside_project'));

notify pgrst, 'reload schema';
