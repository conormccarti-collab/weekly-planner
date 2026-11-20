-- A snapshot of the task's Content Type at the time an estimate was set,
-- so the "same content type and stage" lookup (brief section 6, tier 2)
-- is a plain filter instead of a join back into asana_tasks.custom_fields.
alter table public.task_meta
  add column if not exists content_type text;
