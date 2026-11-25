import type { DayCapacityView } from "@/lib/calendar/week-capacity";
import { parseHHMM } from "@/lib/time";

function Stat({ label, value, sub, valueClassName = "text-chalk" }: { label: string; value: string; sub?: string; valueClassName?: string }) {
  return (
    <div className="rounded-xl border border-border bg-slate px-3 py-2 shadow-sm">
      <div className="text-[11px] font-medium text-chalk-dim">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        <span className={`text-sm font-bold ${valueClassName}`}>{value}</span>
        {sub && <span className="text-[11px] text-chalk-dim">{sub}</span>}
      </div>
    </div>
  );
}

/**
 * The mockup's summary metrics bar — four figures, each sourced from data
 * already computed elsewhere (nothing invented; brief rule 2/3, "arithmetic
 * is code" / "nothing is invented"). "Scheduled" and "Completed" are
 * confirmed hours only — a suggested-but-unconfirmed estimate doesn't count
 * toward either, same as the rest of the app.
 */
export function StatsStrip({
  weekPlannedHours,
  weekCapacityHours,
  weekCompletedHours,
  days,
  unscheduledCount,
  unscheduledHours,
}: {
  weekPlannedHours: number;
  weekCapacityHours: number;
  weekCompletedHours: number;
  days: DayCapacityView[];
  unscheduledCount: number;
  unscheduledHours: number;
}) {
  const events = days.flatMap((d) => d.events);
  const eventHours = events.reduce((sum, e) => {
    if (e.allDay || !e.startLabel || !e.endLabel) return sum;
    return sum + (parseHHMM(e.endLabel) - parseHHMM(e.startLabel)) / 60;
  }, 0);
  const completedPct = weekCapacityHours > 0 ? Math.round((weekCompletedHours / weekCapacityHours) * 100) : 0;

  return (
    <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Stat label="Scheduled this week" value={`${weekPlannedHours.toFixed(1)}h`} sub={`of ${weekCapacityHours.toFixed(1)}h`} />
      <Stat label="Completed" value={`${weekCompletedHours.toFixed(1)}h`} sub={`${completedPct}%`} valueClassName="text-success" />
      <Stat label="Calendar events" value={`${events.length}`} sub={`${eventHours.toFixed(1)}h`} valueClassName="text-danger" />
      <Stat label="Unscheduled" value={`${unscheduledCount}`} sub={`${unscheduledHours.toFixed(1)}h`} valueClassName="text-accent" />
    </div>
  );
}
