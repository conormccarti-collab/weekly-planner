-- v5 Stage 12c: "store an input hash on the week... if the hash is
-- unchanged, the build does nothing and writes nothing." Lets
-- refreshDraftWeek skip the rebuild (and its write) entirely when nothing
-- that would change the outcome has changed since the last build.
alter table public.weeks add column if not exists input_hash text;

notify pgrst, 'reload schema';
