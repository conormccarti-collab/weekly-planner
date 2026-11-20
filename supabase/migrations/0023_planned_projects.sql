-- v5 Stage 12d: "Plan only: tasks and subtasks in Visual Content Pipeline
-- whose parent is not completed, tasks in Production & Shoots, and personal
-- tasks. A setting 'Planned projects' lists the included projects,
-- defaulting to those two."
alter table public.settings
  add column if not exists planned_project_gids text[] not null default array['1220595755618852', '1220595755659253'];

notify pgrst, 'reload schema';
