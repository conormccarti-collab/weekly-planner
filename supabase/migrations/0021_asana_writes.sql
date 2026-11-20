-- v4 Stage 10: write-back to Asana — exactly two actions (complete, change
-- due date), always behind an explicit approval, each one logged here.

create table if not exists public.asana_writes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  task_gid text not null,
  field text not null check (field in ('completed', 'due_on')),
  old_value text,
  new_value text not null,
  created_at timestamptz not null default now()
);

create index if not exists asana_writes_user_task_idx on public.asana_writes (user_id, task_gid, created_at);

alter table public.asana_writes enable row level security;

create policy "asana_writes: owner all" on public.asana_writes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

notify pgrst, 'reload schema';
