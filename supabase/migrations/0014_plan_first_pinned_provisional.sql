-- v3 plan-first: a manually-touched block is pinned so re-planning never
-- moves it, and a task with no real estimate gets a provisional placeholder
-- instead of being skipped.

alter table public.plan_items
  add column if not exists pinned boolean not null default false;

alter table public.plan_items
  drop constraint if exists plan_items_status_check;

alter table public.plan_items
  add constraint plan_items_status_check
  check (status in ('planned', 'done', 'behind', 'moved', 'provisional'));
