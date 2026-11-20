-- Stage 2: Asana sync cache, parking, and sync history.
-- asana_tasks identity is the Asana gid — a task appears once however many
-- projects or sync passes touch it (brief section 4).

create table if not exists public.asana_projects (
  gid text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  notes text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.asana_projects enable row level security;

create policy "asana_projects: owner all" on public.asana_projects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.asana_tasks (
  gid text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  parent_gid text,
  parent_name text,
  project_gids text[] not null default '{}',
  project_names text[] not null default '{}',
  section_names text[] not null default '{}',
  due_on date,
  start_on date,
  completed boolean not null default false,
  completed_at timestamptz,
  custom_fields jsonb not null default '{}',
  subtask_count integer not null default 0,
  permalink_url text,
  assignee_gid text,
  assignee_name text,
  -- Classification derived from the Asana parent/subtask rules (brief section 5):
  -- a container is never plannable itself; a subtask is plannable unless it is
  -- assigned to someone other than the user.
  is_container boolean not null default false,
  is_plannable boolean not null default false,
  no_longer_assigned boolean not null default false,
  asana_modified_at timestamptz,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.asana_tasks enable row level security;

create policy "asana_tasks: owner all" on public.asana_tasks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.task_meta (
  user_id uuid not null references auth.users (id) on delete cascade,
  source text not null check (source in ('asana', 'personal')),
  reference text not null,
  parked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, source, reference)
);

alter table public.task_meta enable row level security;

create policy "task_meta: owner all" on public.task_meta
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.sync_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source text not null default 'asana',
  started_at timestamptz not null,
  finished_at timestamptz,
  ok boolean,
  error text
);

alter table public.sync_log enable row level security;

create policy "sync_log: owner all" on public.sync_log
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
