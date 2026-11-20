-- Replace the single global lunch_start with a per-day lunch time,
-- shown next to the per-day start time on the settings screen.

alter table public.settings add column lunch_times jsonb not null default '{
  "mon": "12:30", "tue": "12:30", "wed": "12:30", "thu": "12:30", "fri": "12:30"
}';

update public.settings set lunch_times = (
  select jsonb_object_agg(day, to_char(lunch_start, 'HH24:MI'))
  from jsonb_array_elements_text(working_days) as day
);

alter table public.settings drop column lunch_start;
