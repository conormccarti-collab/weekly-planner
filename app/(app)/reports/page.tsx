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
    <div>
      <h1 className="text-lg font-semibold">Reports</h1>
      <p className="mt-1 text-sm text-chalk-dim">
        Planned vs. actual hours by Video Type and stage, from blocks marked Done. Feeds the capacity review.
      </p>

      <div className="mt-3 flex items-center gap-2 text-xs">
        {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
          <Link
            key={p}
            href={`/reports?period=${p}`}
            className={`rounded border px-2 py-1 ${p === period ? "border-accent bg-accent text-on-accent" : "border-border text-chalk hover:bg-surface-hover"}`}
          >
            {PERIOD_LABELS[p]}
          </Link>
        ))}
        <a
          href={`/api/reports/estimate-csv?period=${period}`}
          className="ml-auto rounded border border-border px-2 py-1 text-chalk hover:bg-surface-hover"
        >
          Export CSV
        </a>
      </div>

      {report.length === 0 ? (
        <p className="mt-4 text-sm text-chalk-dim">No placed Asana blocks with a Video Type and recognised stage in this period.</p>
      ) : (
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-chalk-dim">
              <th className="py-1">Video Type</th>
              <th>Stage</th>
              <th className="text-right">Planned</th>
              <th className="text-right">Actual</th>
              <th className="text-right">Done blocks</th>
              <th className="text-right">Difference</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {report.map((row) => {
              const variants = defaultVariantsByKey.get(`${row.videoType}:${row.stage}`) ?? [];
              return (
                <tr key={`${row.videoType}:${row.stage}`} className="border-b border-border text-chalk">
                  <td className="py-1.5">{row.videoType}</td>
                  <td>{row.stage}</td>
                  <td className="text-right">{row.plannedHours.toFixed(1)}h</td>
                  <td className="text-right">{row.actualHours.toFixed(1)}h</td>
                  <td className="text-right">{row.doneBlockCount}</td>
                  <td className={`text-right ${row.difference > 0 ? "text-danger" : "text-success"}`}>
                    {row.difference >= 0 ? "+" : ""}
                    {row.difference.toFixed(1)}h
                  </td>
                  <td className="text-right">
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
      )}
    </div>
  );
}
