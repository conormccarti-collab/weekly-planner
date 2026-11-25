import type { RemindersData } from "@/lib/reminders";

/**
 * Follow-up reminders only — a subtask you don't own, due soon, on a task
 * that is yours. There's no placed block to attach this to (the subtask
 * isn't assigned to you, so it's never scheduled), so it stays its own
 * section. The "check it off in Asana" reminder instead shows inline on the
 * task's own row once it's marked done (components/week/entry-row.tsx).
 */
export function RemindersList({ data }: { data: RemindersData }) {
  if (data.followUps.length === 0) return null;

  return (
    <div className="mb-4 rounded border border-info bg-info-tint p-3 text-sm text-chalk">
      <p className="font-medium text-chalk">Follow up</p>
      <ul className="mt-1 space-y-1 text-xs">
        {data.followUps.map((f) => (
          <li key={f.subtaskGid}>
            {f.containerName} — {f.subtaskName}
            {f.assigneeName && <>, assigned to {f.assigneeName}</>}, due {f.dueOn}
            {f.isOverdue && <span className="ml-1 font-medium text-danger">(overdue)</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
