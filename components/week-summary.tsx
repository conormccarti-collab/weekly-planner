import { buildWeekSummaryFacts, templateSummary } from "@/lib/summary";
import { phraseWeekSummary } from "@/lib/chat/claude";
import type { WeekViewData } from "@/lib/week-view-data";
import { SameDayCheckList } from "@/components/same-day-check";
import { SummaryAutoRefresh } from "@/components/summary-auto-refresh";

/**
 * Brief section 7: a short text panel above the calendar, rebuilt from
 * computed facts (`lib/summary.ts`) and phrased by the model into 2-3
 * sentences — falling back to a fixed template if that call fails.
 */
export async function WeekSummary({ data, nowMinutes }: { data: WeekViewData; nowMinutes: number }) {
  const facts = buildWeekSummaryFacts(data, data.workingDays, nowMinutes);

  let text: string;
  try {
    text = await phraseWeekSummary(facts);
  } catch {
    text = templateSummary(facts);
  }

  return (
    <div className="mb-4 rounded border border-border bg-info-tint p-3 text-sm text-chalk">
      <SummaryAutoRefresh />
      <p>{text}</p>
      {facts.endedNotDone.length > 0 && <SameDayCheckList blocks={facts.endedNotDone} />}
    </div>
  );
}
