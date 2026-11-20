-- DO NOT RUN THIS UNTIL THE NEW BUILD (the one that never writes
-- status='provisional') IS DEPLOYED TO PRODUCTION.
--
-- 0017 renamed 'provisional' to 'suggested', but the then-live production
-- app (old code) kept inserting 'provisional' rows mid-migration, so the
-- constraint was widened to accept both as a bridge. This re-tightens it
-- back to the five real values once nothing is writing 'provisional'
-- anymore. Running it before deploy will break the still-live old app.

update public.plan_items set status = 'suggested' where status = 'provisional';

alter table public.plan_items
  drop constraint if exists plan_items_status_check;

alter table public.plan_items
  add constraint plan_items_status_check
  check (status in ('planned', 'done', 'behind', 'moved', 'suggested'));

notify pgrst, 'reload schema';
