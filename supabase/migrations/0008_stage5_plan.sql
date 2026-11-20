-- Stage 5: the week's plan — one row per planned week, one row per
-- task-day placement (a task split across days gets one row per day).

create table if not exists public.weeks (
  user_id uuid not null references auth.users (id) on delete cascade,
  week_start date not null,
  status text not null default 'draft' check (status in ('draft', 'saved')),
  capacity_snapshot jsonb,
  saved_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (user_id, week_start)
);

alter table public.weeks enable row level security;

create policy "weeks: owner all" on public.weeks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.plan_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  week_start date not null,
  source text not null check (source in ('asana', 'personal')),
  reference text not null,
  must boolean not null default false,
  day date,
  hours numeric,
  position integer not null default 0,
  status text not null default 'planned' check (status in ('planned', 'done', 'behind', 'moved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists plan_items_week_idx on public.plan_items (user_id, week_start);

alter table public.plan_items enable row level security;

create policy "plan_items: owner all" on public.plan_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
