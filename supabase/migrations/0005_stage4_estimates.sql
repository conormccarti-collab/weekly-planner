-- Stage 4: stage detection, estimates and their history (brief section 6).

alter table public.task_meta
  add column if not exists stage text,
  add column if not exists focus_type text,
  add column if not exists estimate_hours numeric,
  add column if not exists remaining_hours numeric,
  add column if not exists estimate_origin text;

-- Seeded from the 2027 Production & Capacity Plan (brief section 6). Global,
-- not per-user — this is app configuration, not personal data. `variant`
-- distinguishes rows sharing a content type + stage that need extra context
-- the app can't infer automatically (e.g. producing vs. overseeing only);
-- '' means no such distinction exists for that row.
create table if not exists public.estimate_defaults (
  content_type text not null,
  stage text not null,
  variant text not null default '',
  hours numeric not null,
  focus_type text not null,
  primary key (content_type, stage, variant)
);

alter table public.estimate_defaults enable row level security;

create policy "estimate_defaults: authenticated read" on public.estimate_defaults
  for select using (auth.role() = 'authenticated');

insert into public.estimate_defaults (content_type, stage, variant, hours, focus_type) values
  ('Narrative', 'Planning & Pre-Production', 'producing', 14, 'shallow'),
  ('Narrative', 'Planning & Pre-Production', 'overseeing', 3.5, 'shallow'),
  ('Any', 'Pre-Edit Review & Brief', '', 2, 'deep'),
  ('Narrative', 'Edit', '', 28, 'deep'),
  ('Narrative', 'Review', 'editor', 0, 'waiting'),
  ('Narrative', 'Revisions', '', 7, 'deep'),
  ('Discovery batch', 'Planning & Pre-Production', '', 21, 'shallow'),
  ('Discovery batch', 'Edit', '', 35, 'deep'),
  ('Discovery batch', 'Revisions', '', 7, 'deep')
on conflict (content_type, stage, variant) do nothing;

create table if not exists public.estimate_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source text not null,
  reference text not null,
  task_type_key text,
  old_hours numeric,
  new_hours numeric not null,
  changed_at timestamptz not null default now()
);

alter table public.estimate_history enable row level security;

create policy "estimate_history: owner all" on public.estimate_history
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
