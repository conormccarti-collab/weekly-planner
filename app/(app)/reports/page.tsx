import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { loadEstimateReport, type Period } from "@/lib/estimate-report-data";
import { UseAsDefaultButton } from "./use-as-default-button";
import { env } from "@/lib/env";
import { utcInstantToLocal } from "@/lib/time";

const PERIOD_LABELS: Record<Period, string> = { month: "This month", quarter: "This quarter", all: "All time" };

/**
 * Brief section 9: the estimate report — "for each Video Type and stage
 * show planned hours, actual hours from blocks marked Done, the number of
 * blocks, and the difference." Feeds the end-of-Q1 2027 capacity review.
 */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;

  if (!user) {
    return <h1 className="text-lg font-semibold">Reports</h1>;
  }

  const period = ((await searchParams).period as Period | undefined) ?? "month";
  const todayStr = utcInstantToLocal(new Date(), env.appTimezone()).dateStr;
  const report = await loadEstimateReport(supabase, user, period, todayStr);

  const { data: defaultRows } = await supabase.from("estimate_defaults").select("video_type, stage, variant, hours");
  const defaultVariantsByKey = new Map<string, { variant: string; hours: number }[]>();
  for (const d of defaultRows ?? []) {
    const key = `${d.video_type}:${d.stage}`;
    const list = defaultVariantsByKey.get(key) ?? [];
    list.push({ variant: d.variant as string, hours: d.hours as number });
    defaultVariantsByKey.set(key, list);
  }

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-lg font-semibold">Reports</h1>
      <p className="mt-1 text-sm text-chalk-dim">
        Planned vs. actual hours by Video Type and stage, from blocks marked Done. Feeds the capacity review.
      </p>

      <div className="mt-4 flex items-center gap-2 text-xs">
        <div className="inline-flex rounded-xl bg-surface-hover p-1">
          {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
            <Link
              key={p}
              href={`/reports?period=${p}`}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${p === period ? "bg-accent text-on-accent" : "text-chalk-dim hover:text-chalk"}`}
            >
              {PERIOD_LABELS[p]}
            </Link>
          ))}
        </div>
        <a
          href={`/api/reports/estimate-csv?period=${period}`}
          className="ml-auto rounded-lg border border-border px-3 py-1.5 font-bold text-chalk hover:bg-surface-hover"
        >
          Export CSV
        </a>
      </div>

      {report.length === 0 ? (
        <p className="mt-4 text-sm text-chalk-dim">No placed Asana blocks with a Video Type and recognised stage in this period.</p>
      ) : (
        <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-slate">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-hover text-left text-[11px] font-bold uppercase tracking-wide text-chalk-dim">
                <th className="px-4 py-2.5">Video Type</th>
                <th className="py-2.5">Stage</th>
                <th className="py-2.5 text-right">Planned</th>
                <th className="py-2.5 text-right">Actual</th>
                <th className="py-2.5 text-right">Done blocks</th>
                <th className="px-4 py-2.5 text-right">Difference</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {report.map((row) => {
                const variants = defaultVariantsByKey.get(`${row.videoType}:${row.stage}`) ?? [];
                return (
                  <tr key={`${row.videoType}:${row.stage}`} className="border-t border-border text-chalk">
                    <td className="px-4 py-2.5 font-bold">{row.videoType}</td>
                    <td className="py-2.5">{row.stage}</td>
                    <td className="py-2.5 text-right">{row.plannedHours.toFixed(1)}h</td>
                    <td className="py-2.5 text-right">{row.actualHours.toFixed(1)}h</td>
                    <td className="py-2.5 text-right">{row.doneBlockCount}</td>
                    <td className={`px-4 py-2.5 text-right ${row.difference > 0 ? "text-danger" : "text-success"}`}>
                      {row.difference >= 0 ? "+" : ""}
                      {row.difference.toFixed(1)}h
                    </td>
                    <td className="py-2.5 pr-4 text-right">
                      {row.suggestedDefault != null &&
                        variants.map((v) => (
                          <UseAsDefaultButton
                            key={v.variant}
                            videoType={row.videoType}
                            stage={row.stage}
                            variant={v.variant}
                            currentHours={v.hours}
                            suggestedHours={Math.round(row.suggestedDefault! * 4) / 4}
                          />
                        ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
