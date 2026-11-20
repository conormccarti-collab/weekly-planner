-- v2 changes, section D: a Settings Office picker that sets the app's
-- accent colour. Purely cosmetic — never touches per-task Brand colours.
alter table public.settings
  add column if not exists office text;
