-- Stage 3: calendar sync cache and recorded actual day-start times.

create table if not exists public.day_starts (
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  start_time time not null,
  corrected boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, date)
);

alter table public.day_starts enable row level security;

create policy "day_starts: owner all" on public.day_starts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.calendar_events (
  user_id uuid not null references auth.users (id) on delete cascade,
  event_id text not null,
  title text not null,
  starts_at timestamptz,
  ends_at timestamptz,
  all_day boolean not null default false,
  start_date date,
  end_date date,
  busy boolean not null default true,
  response_status text,
  last_synced_at timestamptz not null default now(),
  primary key (user_id, event_id)
);

alter table public.calendar_events enable row level security;

create policy "calendar_events: owner all" on public.calendar_events
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
