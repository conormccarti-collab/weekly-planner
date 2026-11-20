-- v3 (plan-first): refreshDraftWeek's delete-then-insert was two separate
-- round trips computed from a single JS-side read. Two overlapping calls
-- (e.g. two near-simultaneous page loads) each read the same pre-write
-- snapshot, so both independently decided the same rows were unprotected
-- and both inserted a fresh copy — producing N duplicate rows for N
-- overlapping calls. A single later call is self-healing (it deletes the
-- whole mess and reinserts one clean copy), but the window itself is a
-- real bug. This function makes the write atomic and self-consistent: it
-- takes an advisory lock scoped to (user_id, week_start) and re-derives
-- which rows are unprotected AT EXECUTION TIME, inside that lock, instead
-- of trusting whatever the caller's possibly-stale read decided earlier.
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
    user_id, week_start, source, reference, day, start_time, end_time, hours, must, status, pinned
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
    coalesce((r->>'pinned')::boolean, false)
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
