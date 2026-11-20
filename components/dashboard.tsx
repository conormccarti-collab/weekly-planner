import type { StageBreakdownRow } from "@/lib/plan";

function formatHours(h: number): string {
  return `${h.toFixed(1)}h`;
}

export function Dashboard({
  weekCapacityHours,
  weekPlannedHours,
  weekProvisionalHours,
  breakdown,
}: {
  weekCapacityHours: number;
  weekPlannedHours: number;
  weekProvisionalHours: number;
  breakdown: StageBreakdownRow[];
}) {
  const overCapacity = weekPlannedHours > weekCapacityHours;
  const confirmedHours = weekPlannedHours - weekProvisionalHours;
  const maxHours = Math.max(weekCapacityHours, ...breakdown.map((r) => Math.max(r.plannedHours, r.actualHours)), 1);

  return (
    <div className="mb-6 rounded border border-border p-4">
      <div className="flex items-baseline justify-between">
        <div>
          <span className="text-2xl font-semibold text-chalk">{formatHours(weekCapacityHours)}</span>
          <span className="ml-2 text-sm text-chalk-dim">available this week</span>
        </div>
        <span className={`text-sm font-medium ${overCapacity ? "text-danger" : "text-chalk-dim"}`}>
          {formatHours(weekPlannedHours)} planned{overCapacity ? " — over capacity" : ""}
          {weekProvisionalHours > 0 && (
            <span className="ml-1 font-normal text-chalk-dim">
              ({formatHours(confirmedHours)} confirmed + {formatHours(weekProvisionalHours)} provisional)
            </span>
          )}
        </span>
      </div>

      {breakdown.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 flex items-center gap-3 text-xs text-chalk-dim">
            <span>By stage</span>
            <span className="ml-auto flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm bg-border" /> planned
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm bg-info" /> actual
            </span>
          </div>
          <ul className="space-y-1.5">
            {breakdown.map((row) => (
              <li key={row.stage} className="flex items-center gap-2 text-xs">
                <span className="w-40 shrink-0 truncate text-chalk">{row.stage}</span>
                <div className="relative h-3 flex-1 overflow-hidden rounded bg-surface-hover">
                  <div
                    className="absolute inset-y-0 left-0 rounded bg-border"
                    style={{ width: `${Math.min(100, (row.plannedHours / maxHours) * 100)}%` }}
                  />
                  {row.actualHours > 0 && (
                    <div
                      className="absolute inset-y-0 left-0 rounded bg-info"
                      style={{ width: `${Math.min(100, (row.actualHours / maxHours) * 100)}%` }}
                    />
                  )}
                </div>
                <span className="w-24 shrink-0 text-right text-chalk-dim">
                  {formatHours(row.actualHours)} / {formatHours(row.plannedHours)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
