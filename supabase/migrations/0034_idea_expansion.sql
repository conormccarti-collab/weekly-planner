-- "Expand with Claude" on the Ideas page: a fleshed-out version of the raw
-- title, stored so it survives a reload instead of being thrown away the
-- moment the user navigates off the page.

alter table public.ideas add column if not exists expanded_text text;
