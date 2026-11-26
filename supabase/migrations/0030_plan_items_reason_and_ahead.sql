-- v5 Stage 13: two small additions to plan_items, both nullable/defaulted so
-- every existing row stays valid with no backfill needed.
--
-- reason: why this row is where it is. For an unplaced row ("day is null"),
-- why it couldn't be placed (already computed in lib/plan-build.ts's
-- stillUnplaced, previously only ever shown transiently in the week-summary
-- text, never persisted or visible in the Unscheduled list itself). For a
-- placed row, the short human reason it landed there (Must, a hard deadline,
-- pulled forward while there was spare capacity, etc.) — Stage 13d's
-- "Why here?" control reads this, never asks the model to invent one.
--
-- is_ahead: true for a work-ahead-fill placement (Stage 13a) — a stage
-- pulled into spare capacity before it was actually due, so the UI can mark
-- it as optional/first-to-move rather than required work.
alter table public.plan_items add column if not exists reason text;
alter table public.plan_items add column if not exists is_ahead boolean not null default false;

-- refresh_draft_week_items (migration 0015) inserts through an explicit
-- column list, so it silently drops reason/is_ahead unless it's taught
-- about them here too.
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
    nullif(r->>'reason', ''),
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

notify pgrst, 'reload schema';
