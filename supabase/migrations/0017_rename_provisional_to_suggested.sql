-- v4 Stage 2, brief section 5.1: "Remove the synthetic one-hour placeholder
-- and rename the status 'provisional' to 'suggested' (migration)." A
-- suggested block is now a real model estimate, not a fixed 1h stand-in,
-- but the status name it's stored under needs to change to match.

update public.plan_items set status = 'suggested' where status = 'provisional';

alter table public.plan_items
  drop constraint if exists plan_items_status_check;

alter table public.plan_items
  add constraint plan_items_status_check
  check (status in ('planned', 'done', 'behind', 'moved', 'suggested'));
