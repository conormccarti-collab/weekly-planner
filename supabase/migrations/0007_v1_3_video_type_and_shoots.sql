-- v1.3 brief changes: "Content Type" renamed to "Video Type" everywhere,
-- new stage set (Creative Brief, Revisions, Shorts, Archive), reseeded
-- estimate defaults keyed by Video Type, and data capture for the new
-- Production & Shoots project + task dependencies (consumed by Stage 5
-- once placement exists — not yet enforced here).

alter table public.task_meta rename column content_type to video_type;
alter table public.estimate_defaults rename column content_type to video_type;

alter table public.asana_tasks
  add column if not exists is_shoot boolean not null default false,
  add column if not exists blocked_by_gids text[] not null default '{}';

delete from public.estimate_defaults;

insert into public.estimate_defaults (video_type, stage, variant, hours, focus_type) values
  ('Youtube Narrative', 'Planning & Pre-Production', 'producing', 14, 'shallow'),
  ('Youtube Narrative', 'Planning & Pre-Production', 'overseeing', 3.5, 'shallow'),
  ('Any', 'Pre-Edit Review & Brief', '', 3.5, 'deep'),
  ('Youtube Narrative', 'Edit', '', 28, 'deep'),
  ('Youtube Narrative', 'Review', 'editor', 0, 'waiting'),
  ('Youtube Narrative', 'Revisions', '', 7, 'deep'),
  ('Youtube Discovery', 'Planning & Pre-Production', '', 21, 'shallow'),
  ('Youtube Discovery', 'Edit', '', 35, 'deep'),
  ('Youtube Discovery', 'Revisions', '', 7, 'deep')
on conflict (video_type, stage, variant) do nothing;
