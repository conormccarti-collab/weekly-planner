-- Free-text standing rules ("never schedule edits on Fridays") that steer
-- scheduling. Each rule is parsed once at creation time (lib/chat/claude.ts's
-- parseSchedulingRule) into a best-effort structured shape the deterministic
-- auto-placement engine can actually obey; anything outside that shape stays
-- 'freeform' — reaching chat context only, never silently claimed as
-- enforced.

create table if not exists public.scheduling_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  text text not null,
  parsed_kind text not null default 'freeform' check (parsed_kind in ('freeform', 'avoid_weekday')),
  parsed_weekday text check (parsed_weekday in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')),
  parsed_stage text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.scheduling_rules enable row level security;

create policy "scheduling_rules: owner all" on public.scheduling_rules
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

notify pgrst, 'reload schema';
