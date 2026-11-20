-- Release 1.1: priority overrides (chat section, "The Brian edit matters
-- less than its date suggests" sets this; Asana is never changed), and a
-- flag so the morning check knows which desk days it has already caught up.

alter table public.task_meta
  add column if not exists priority_override text;

alter table public.day_starts
  add column if not exists morning_check_done boolean not null default false;
