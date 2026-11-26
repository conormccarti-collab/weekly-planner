-- A lightweight "here's what I changed and why" trail for mutations the
-- app makes on its own initiative (a guessed estimate, a stale placement
-- swept forward) rather than in direct response to a user action.

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  summary text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);

alter table public.audit_log enable row level security;

create policy "audit_log: owner all" on public.audit_log
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists audit_log_user_created_idx on public.audit_log (user_id, created_at desc);
