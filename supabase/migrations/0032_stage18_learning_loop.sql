-- v5 Stage 18: the learning loop.
--
-- 18a (time tracking): plan_items.started_at records when a block was
-- actually started (the "Start" button), separate from actual_hours (which
-- records how long it took, set on completion). refresh_draft_week_items
-- (0015, amended 0030) is amended again so a started-but-not-yet-done block
-- is protected from its delete-and-reinsert the same way a pinned or
-- already-done/behind block already is — a Regenerate the same day
-- shouldn't erase that a block was actually started.
--
-- 18b (event-pattern learning): widens plan_events (0024), previously only
-- 'rejected', to also log 'moved' — the raw signal a pattern-learner reads
-- to notice things like "you always move Edit blocks to mornings."
--
-- 18c (suggestion cards): learned_suggestions holds one row per detected
-- pattern. Approving calls the existing addSchedulingRule with rule_text;
-- rejecting sets snoozed_until to 30 days out. Same dismissed-timestamp
-- shape as reminders (0028), but nullable/resettable rather than one-way,
-- since a pattern that keeps recurring past the snooze should resurface.

alter table public.plan_items add column if not exists started_at timestamptz;

create or replace function refresh_draft_week_items(
  p_user_id uuid,
  p_week_start date,
  p_today date,
  p_insert_rows jsonb,
  p_following_week_start date,
  p_moved_rows jsonb
) returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtext(p_user_id::text || ':' || p_week_start::text));

  delete from plan_items
  where user_id = p_user_id
    and week_start = p_week_start
    and not pinned
    and status not in ('done', 'behind')
    and started_at is null
    and (day is null or day >= p_today);

  insert into plan_items (
    user_id, week_start, source, reference, day, start_time, end_time, hours, must, status, pinned, reason, is_ahead
  )
  select
    p_user_id,
    p_week_start,
    r->>'source',
    r->>'reference',
    nullif(r->>'day', '')::date,
    nullif(r->>'start_time', '')::time,
    nullif(r->>'end_time', '')::time,
    nullif(r->>'hours', '')::numeric,
    coalesce((r->>'must')::boolean, false),
    r->>'status',
    coalesce((r->>'pinned')::boolean, false),
    r->>'reason',
    coalesce((r->>'is_ahead')::boolean, false)
  from jsonb_array_elements(p_insert_rows) as r;

  if jsonb_array_length(p_moved_rows) > 0 then
    perform pg_advisory_xact_lock(hashtext(p_user_id::text || ':' || p_following_week_start::text));

    insert into plan_items (user_id, week_start, source, reference, day, hours, must, status, pinned)
    select p_user_id, p_following_week_start, r->>'source', r->>'reference', null, null, false, 'planned', false
    from jsonb_array_elements(p_moved_rows) as r
    where not exists (
      select 1 from plan_items existing
      where existing.user_id = p_user_id
        and existing.week_start = p_following_week_start
        and existing.source = r->>'source'
        and existing.reference = r->>'reference'
    );
  end if;
end;
$$;

grant execute on function refresh_draft_week_items(uuid, date, date, jsonb, date, jsonb) to authenticated;

alter table public.plan_events drop constraint if exists plan_events_event_type_check;
alter table public.plan_events add constraint plan_events_event_type_check check (event_type in ('rejected', 'moved'));

create table if not exists public.learned_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  pattern_key text not null,
  rule_text text not null,
  created_at timestamptz not null default now(),
  snoozed_until timestamptz,
  unique (user_id, pattern_key)
);

alter table public.learned_suggestions enable row level security;

create policy "learned_suggestions: owner all" on public.learned_suggestions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

notify pgrst, 'reload schema';
