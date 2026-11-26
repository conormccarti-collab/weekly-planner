-- The complement to day_locks (0026): day_locks marks an otherwise-working
-- date as unavailable; this marks an otherwise-non-working date (a
-- weekend, or any weekday outside settings.working_days) as a real
-- working day for that one date, with real capacity, eligible for
-- auto-placement and Re-prioritise like any other day — "I'll be working
-- Saturday and Sunday this week." Same shape as day_locks, one row per
-- user+date.

create table if not exists public.working_day_overrides (
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  reason text,
  created_at timestamptz not null default now(),
  primary key (user_id, date)
);

alter table public.working_day_overrides enable row level security;

create policy "working_day_overrides: owner all" on public.working_day_overrides
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

notify pgrst, 'reload schema';
