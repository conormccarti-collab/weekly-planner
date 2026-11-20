/**
 * Release 1.1, brief section 9: "The Brian edit matters less than its date
 * suggests" sets a priority override in `task_meta` — Asana itself is never
 * changed. The override always wins over whatever Asana's Priority field says.
 */
export function resolvePriority(asanaPriority: string | null, override: string | null): string | null {
  return override ?? asanaPriority;
}
