-- v5 Stage 13a: "Reserve the buffer setting per day as a labelled free
-- area." Decided default is 15% (brief section 3, "decisions already
-- made") — distinct from the pre-existing planning_percentage, which only
-- scales a reported capacity figure and never actually withholds real
-- placement time (lib/capacity.ts's freeBlocks).
alter table public.settings add column if not exists buffer_percentage integer not null default 15;

notify pgrst, 'reload schema';
