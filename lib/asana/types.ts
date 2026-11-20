export type AsanaCustomField = {
  name: string;
  display_value: string | null;
};

export type AsanaProjectRef = { gid: string; name: string };

export type AsanaTask = {
  gid: string;
  name: string;
  resource_subtype?: string;
  completed: boolean;
  completed_at: string | null;
  due_on: string | null;
  start_on: string | null;
  modified_at: string | null;
  num_subtasks: number;
  permalink_url: string | null;
  parent: { gid: string; name: string } | null;
  assignee: { gid: string; name: string } | null;
  projects: AsanaProjectRef[];
  memberships: { project: AsanaProjectRef; section: { gid: string; name: string } | null }[];
  custom_fields: AsanaCustomField[];
  /** Tasks this one is blocked by (v1.3: shoots block their deliverable's post-shoot stages). */
  dependencies?: { gid: string }[];
};

export type AsanaUser = { gid: string; name: string; email: string };
