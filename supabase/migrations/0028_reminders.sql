-- Personal-assistant reminders: in-app only, no write-back, no email.
-- "Completed in app" reminders persist until dismissed or auto-resolved
-- (asana_tasks.completed becomes true at a later sync). Follow-up
-- (subtask-deadline) reminders are computed at read time and never stored.

create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('asana_checkoff')),
  reference text not null, -- the Asana task gid
  created_at timestamptz not null default now(),
  dismissed_at timestamptz,
  unique (user_id, kind, reference)
);

create index if not exists reminders_user_pending_idx
  on public.reminders (user_id, kind) where dismissed_at is null;

alter table public.reminders enable row level security;

create policy "reminders: owner all" on public.reminders
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

notify pgrst, 'reload schema';
