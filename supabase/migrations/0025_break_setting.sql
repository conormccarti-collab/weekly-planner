-- v5 Stage 12g §C: a break (lunch) option. Fixed mode reuses the existing
-- lunch_times/lunch_minutes columns exactly as before; flexible mode floats
-- the same length within a midday window the planner keeps free, dodging
-- meetings that land on the fixed time.
--
-- lunch_minutes/lunch_times already existed and were applied
-- unconditionally (see lib/capacity.ts) — this migration seeds
-- lunch_enabled=true, lunch_mode='fixed' so that behaviour is preserved
-- exactly as it was (real current values: lunch_minutes 60, lunch_times
-- 12:30 every working day). Capacity math does not change until the user
-- edits this setting themselves — e.g. to flip it off, or to 'flexible'.
alter table public.settings
  add column if not exists lunch_enabled boolean not null default true,
  add column if not exists lunch_mode text not null default 'fixed' check (lunch_mode in ('fixed', 'flexible')),
  add column if not exists lunch_window_start time not null default '12:00',
  add column if not exists lunch_window_end time not null default '14:00';

-- v5 Stage 12g §B: "Minimum part size is a setting (default 1h)" — the
-- floor below which an auto-split (drag-time push or the initial weekly
-- build) won't open a new part, used by lib/resolve-drop.ts and
-- lib/auto-placement.ts.
alter table public.settings
  add column if not exists min_split_part_minutes integer not null default 60;

notify pgrst, 'reload schema';
