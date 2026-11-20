-- Calendar redesign: a placement is now a time-of-day range within a day,
-- not just a day + a total hours figure. `hours` stays as a denormalized
-- convenience (kept in sync with start_time/end_time) so existing pure
-- aggregation code keeps working unchanged.
alter table public.plan_items
  add column if not exists start_time time,
  add column if not exists end_time time;

-- Any existing placed (day-set) rows have no time-of-day yet — give them a
-- nominal 09:00 start so they remain visible rather than silently dropping
-- off the calendar. In practice there are none at the time of writing.
update public.plan_items
set start_time = '09:00',
    end_time = ('09:00'::time + make_interval(mins => round(hours * 60)::int))::time
where day is not null and start_time is null and hours is not null;
