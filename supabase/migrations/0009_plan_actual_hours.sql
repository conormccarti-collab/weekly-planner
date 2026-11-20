-- Record keeper: planned vs. actual hours per task, by stage, for the week.
alter table public.plan_items
  add column if not exists actual_hours numeric;
