import { buildWeekSummaryFacts } from "@/lib/summary";
import type { WeekViewData } from "@/lib/week-view-data";
import { formatHHMM } from "@/lib/time";
import { SameDayCheckList } from "@/components/same-day-check";
import { SummaryAutoRefresh } from "@/components/summary-auto-refresh";

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="text-xs font-semibold text-chalk">{label}</span>
      <div className="mt-0.5 space-y-0.5">{children}</div>
    </div>
  );
}

function Line({ children }: { children: React.ReactNode }) {
  return <div className="text-xs text-chalk">{children}</div>;
}

/**
 * v5 Stage 12f.1: "Structured card, not a text block: a bold label per
 * section, one item per line." Rendered directly from the same facts
 * (`lib/summary.ts`) every section always used — no model call, since a
 * card of plain facts needs no phrasing (and nothing here to cache or
 * re-call on a timer, unlike the old prose version).
 */
export async function WeekSummary({ data, nowMinutes }: { data: WeekViewData; nowMinutes: number }) {
  const facts = buildWeekSummaryFacts(data, data.workingDays, nowMinutes);
  const freeOrOver =
    facts.week.freeOrOverHours >= 0 ? `${facts.week.freeOrOverHours.toFixed(1)}h free` : `${Math.abs(facts.week.freeOrOverHours).toFixed(1)}h over`;

  return (
    <div className="mb-4 rounded border border-border bg-info-tint p-3 text-sm text-chalk">
      <SummaryAutoRefresh />
      <div className="space-y-2">
        <Section label="Now">
          {facts.now ? (
            <Line>
              {facts.now.name} ({formatHHMM(facts.now.startMinutes)}–{formatHHMM(facts.now.endMinutes)})
            </Line>
          ) : facts.next.length > 0 ? (
            <Line>Nothing right now — next: {facts.next[0].name} at {formatHHMM(facts.next[0].startMinutes)}</Line>
          ) : (
            <Line>Nothing scheduled right now</Line>
          )}
        </Section>

        {facts.next.length > 0 && (
          <Section label="Next">
            {facts.next.map((b, i) => (
              <Line key={i}>
                {b.name} ({formatHHMM(b.startMinutes)}–{formatHHMM(b.endMinutes)})
              </Line>
            ))}
          </Section>
        )}

        <Section label="Today">
          {facts.today.zeroCapacityReason ? (
            <Line>{facts.today.zeroCapacityReason}</Line>
          ) : (
            <Line>
              <b>{facts.today.plannedHours.toFixed(1)}h</b> planned of <b>{facts.today.capacityHours.toFixed(1)}h</b>,{" "}
              <b>{facts.today.doneHours.toFixed(1)}h</b> done
            </Line>
          )}
        </Section>

        {facts.atRisk.length > 0 && (
          <Section label="At risk">
            {facts.atRisk.map((line, i) => (
              <Line key={i}>{line}</Line>
            ))}
          </Section>
        )}

        <Section label="This week">
          {facts.week.zeroCapacityReason ? (
            <Line>{facts.week.zeroCapacityReason}</Line>
          ) : (
            <Line>
              <b>{facts.week.plannedHours.toFixed(1)}h</b> placed of <b>{facts.week.capacityHours.toFixed(1)}h</b> capacity, <b>{freeOrOver}</b>
            </Line>
          )}
          {facts.monday && (
            <Line>
              <b>{facts.monday.workingHours.toFixed(1)}h</b> of working hours this week
              {facts.monday.leftOut.length > 0 && <> — left out of next week: {facts.monday.leftOut.join(", ")}</>}
            </Line>
          )}
        </Section>

        {facts.week.notFit.length > 0 && (
          <Section label="Didn't fit">
            {facts.week.notFit.map((n, i) => (
              <Line key={i}>
                {n.name} — {n.reason}
              </Line>
            ))}
          </Section>
        )}

        {facts.week.suggestedEstimateTasks.length > 0 && (
          <Section label="Suggested estimates">
            {facts.week.suggestedEstimateTasks.map((name, i) => (
              <Line key={i}>{name}</Line>
            ))}
          </Section>
        )}

        {facts.week.hygieneIssues.length > 0 && (
          <Section label="Hygiene">
            <Line>
              <b>{facts.week.hygieneIssues.length}</b> issue{facts.week.hygieneIssues.length === 1 ? "" : "s"} — top three:{" "}
              {facts.week.hygieneIssues.slice(0, 3).join("; ")}
            </Line>
          </Section>
        )}

        <Section label="Next week">
          <Line>
            <b>{facts.nextWeek.plannedHours.toFixed(1)}h</b> planned of <b>{facts.nextWeek.capacityHours.toFixed(1)}h</b> capacity
            {facts.nextWeek.topThree.length > 0 && <> — top: {facts.nextWeek.topThree.join(", ")}</>}
            {facts.nextWeek.cannotFit.length > 0 && <> — couldn&apos;t fit: {facts.nextWeek.cannotFit.join(", ")}</>}
          </Line>
        </Section>
      </div>
      {facts.endedNotDone.length > 0 && <SameDayCheckList blocks={facts.endedNotDone} />}
    </div>
  );
}
