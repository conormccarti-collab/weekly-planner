-- v4 Stage 7: the daily notification toggle — off by default.

alter table public.settings
  add column if not exists notifications_enabled boolean not null default false;
