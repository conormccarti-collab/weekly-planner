-- v5 Stage 12e.1: "Rejecting a block removes it at once, records the
-- rejection... regeneration does not put it back in the same slot."
-- Also the shared event log Stage 18 (the learning loop) reuses later for
-- accept/reject/move/split/resize patterns — scoped here to just what
-- Stage 12e needs (rejected), widened by a later migration when Stage 18
-- actually needs more event types.
create table if not exists public.plan_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  event_type text not null check (event_type in ('rejected')),
  source text not null check (source in ('asana', 'personal')),
  reference text not null,
  week_start date not null,
  day date,
  start_time time,
  end_time time,
  created_at timestamptz not null default now()
);

create index if not exists plan_events_lookup on public.plan_events (user_id, week_start, source, reference);

alter table public.plan_events enable row level security;

create policy "plan_events: owner all" on public.plan_events
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

notify pgrst, 'reload schema';
