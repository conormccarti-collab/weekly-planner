-- Stage 1: settings (working pattern) and the encrypted store for the
-- Google Calendar refresh token captured at sign-in (used by Stage 3).

create table if not exists public.settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  working_days jsonb not null default '["mon","tue","wed","thu","fri"]',
  hours_per_day numeric not null default 7,
  start_times jsonb not null default '{
    "mon": "09:30", "tue": "08:30", "wed": "08:30", "thu": "08:30", "fri": "08:30"
  }',
  lunch_start time not null default '12:30',
  lunch_minutes integer not null default 60,
  planning_percentage integer not null default 100,
  min_deep_work_block_minutes integer not null default 60,
  timezone text not null default 'Europe/London',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.settings enable row level security;

create policy "settings: owner select" on public.settings
  for select using (auth.uid() = user_id);

create policy "settings: owner insert" on public.settings
  for insert with check (auth.uid() = user_id);

create policy "settings: owner update" on public.settings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- No select/insert/update/delete policies for authenticated/anon roles:
-- this table is written only by the auth callback using the service-role key.
create table if not exists public.oauth_tokens (
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null,
  refresh_token_encrypted text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);

alter table public.oauth_tokens enable row level security;
