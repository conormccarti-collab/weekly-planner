-- Stages 6/7: personal tasks (created via chat's Monday-list flow), the
-- ideas list, and per-project notes.

create table if not exists public.personal_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  estimate_hours numeric,
  priority text,
  due_on date,
  completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.personal_tasks enable row level security;

create policy "personal_tasks: owner all" on public.personal_tasks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.ideas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  status text not null default 'open' check (status in ('open', 'converted', 'dropped')),
  converted_personal_task_id uuid references public.personal_tasks (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.ideas enable row level security;

create policy "ideas: owner all" on public.ideas
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.project_notes (
  user_id uuid not null references auth.users (id) on delete cascade,
  project_name text not null,
  notes text not null default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, project_name)
);

alter table public.project_notes enable row level security;

create policy "project_notes: owner all" on public.project_notes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
