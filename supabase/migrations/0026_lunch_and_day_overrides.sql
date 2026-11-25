-- Per-date overrides, mirroring day_starts exactly (one row per user+date).
-- lunch_overrides: a specific date's lunch start time, distinct from the
-- per-weekday default in settings.lunch_times.
-- day_locks: a specific date marked unavailable (out of office) — excluded
-- from auto-placement entirely (see getWeekCapacity/gatherWeekBuildInputs),
-- never force-moves anything already placed there.

create table if not exists public.lunch_overrides (
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  lunch_start_time time not null,
  created_at timestamptz not null default now(),
  primary key (user_id, date)
);

alter table public.lunch_overrides enable row level security;

create policy "lunch_overrides: owner all" on public.lunch_overrides
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.day_locks (
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  reason text,
  created_at timestamptz not null default now(),
  primary key (user_id, date)
);

alter table public.day_locks enable row level security;

create policy "day_locks: owner all" on public.day_locks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

notify pgrst, 'reload schema';
