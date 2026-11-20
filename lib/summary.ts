import type { WeekViewData } from "@/lib/week-view-data";
import type { Weekday } from "@/lib/time";
import { addWorkingDays, formatHHMM } from "@/lib/time";

export type SummaryBlock = { name: string; startMinutes: number; endMinutes: number };

export type EndedNotDoneBlock = {
  blockId: string;
  source: "asana" | "personal";
  reference: string;
  name: string;
  startMinutes: number;
  endMinutes: number;
  plannedHours: number;
};

export type WeekSummaryFacts = {
  now: SummaryBlock | null;
  next: SummaryBlock[];
  today: { plannedHours: number; capacityHours: number; doneHours: number };
  /** Fully-computed fact lines (deadlines, over-capacity, needs-estimate) — a model may only phrase these, never invent numbers. Omit the section entirely if empty. */
  atRisk: string[];
  /** Rendered as fixed-format one-tap prompts, not through the model (brief 7, "How it works" bullet 3). */
  endedNotDone: EndedNotDoneBlock[];
  nextWeek: { plannedHours: number; capacityHours: number; topThree: string[]; cannotFit: string[] };
  /** Brief 7: "The Monday summary also says how many working hours the week has and what was left out." */
  monday: { workingHours: number; leftOut: string[] } | null;
};

/**
 * Pure facts-assembler (brief section 7) — everything here is already
 * computed by `loadWeekViewData`; this just reshapes it for the summary.
 * The caller passes `nowMinutes` explicitly so this stays testable without
 * mocking the clock.
 */
export function buildWeekSummaryFacts(data: WeekViewData, workingDays: Weekday[], nowMinutes: number): WeekSummaryFacts {
  const todayStr = data.todayStr;

  type TodayEntry = EndedNotDoneBlock & { status: string; actualHours: number | null };
  const todayEntries: TodayEntry[] = [];
  for (const task of data.thisWeekTasks) {
    for (const p of task.placements) {
      if (p.day !== todayStr) continue;
      todayEntries.push({
        blockId: p.id,
        source: task.source,
        reference: task.reference,
        name: task.name,
        startMinutes: p.startMinutes,
        endMinutes: p.endMinutes,
        plannedHours: p.hours,
        status: p.status,
        actualHours: p.actualHours,
      });
    }
  }
  todayEntries.sort((a, b) => a.startMinutes - b.startMinutes);

  const current = todayEntries.find((e) => e.startMinutes <= nowMinutes && nowMinutes < e.endMinutes) ?? null;
  const upcoming = todayEntries.filter((e) => e !== current && e.startMinutes >= nowMinutes);
  const toBlock = (e: TodayEntry): SummaryBlock => ({ name: e.name, startMinutes: e.startMinutes, endMinutes: e.endMinutes });

  const now = current ? toBlock(current) : null;
  const next = upcoming.slice(0, 2).map(toBlock);

  const todayCapacity = data.capacityDays.find((d) => d.dateStr === todayStr)?.plannedCapacityHours ?? 0;
  const todayPlannedHours = todayEntries.reduce((sum, e) => sum + e.plannedHours, 0);
  const todayDoneHours = todayEntries.reduce((sum, e) => sum + (e.status === "done" && e.actualHours != null ? e.actualHours : 0), 0);

  const endedNotDone: EndedNotDoneBlock[] = todayEntries
    .filter((e) => e.endMinutes <= nowMinutes && e.status !== "done" && e.status !== "behind")
    .map(({ status: _status, actualHours: _actualHours, ...block }) => block);

  const atRisk: string[] = [];

  const deadlineCutoff = addWorkingDays(todayStr, 2, workingDays);
  const atRiskDeadlines = [...data.thisWeekTasks, ...data.everythingElseGroups.flatMap((g) => g.tasks)].filter(
    (t) => t.dueOn != null && t.dueOn <= deadlineCutoff
  );
  for (const t of atRiskDeadlines) {
    atRisk.push(`${t.name} is due ${t.dueOn} (within 2 working days)`);
  }

  if (data.weekPlannedHours > data.weekCapacityHours) {
    atRisk.push(`This week is ${(data.weekPlannedHours - data.weekCapacityHours).toFixed(1)}h over capacity`);
  }

  const needsEstimateCount = data.thisWeekTasks.filter(
    (t) => t.placements.some((p) => p.status === "provisional") || (t.placements.length === 0 && t.estimateHours == null && !t.estimateAmbiguousOptions?.length)
  ).length;
  if (needsEstimateCount > 0) {
    atRisk.push(`${needsEstimateCount} task${needsEstimateCount === 1 ? "" : "s"} still need${needsEstimateCount === 1 ? "s" : ""} an estimate`);
  }

  const isMonday = todayStr === data.weekStart;
  const monday = isMonday ? { workingHours: data.weekCapacityHours, leftOut: data.followingWeekUnplaced.map((u) => u.name) } : null;

  return {
    now,
    next,
    today: { plannedHours: todayPlannedHours, capacityHours: todayCapacity, doneHours: todayDoneHours },
    atRisk,
    endedNotDone,
    nextWeek: {
      plannedHours: data.followingWeekPlannedHours,
      capacityHours: data.followingWeekCapacityHours,
      topThree: data.followingWeekTopRanked.map((t) => t.name),
      cannotFit: data.followingWeekUnplaced.map((u) => u.name),
    },
    monday,
  };
}

/**
 * Brief 7, "How it works": "If the model call fails, show a fixed template
 * built from the same facts." Deliberately simpler than the model's
 * phrasing (e.g. it doesn't distinguish "between blocks" from "outside
 * working hours" when `now` is null) — it's the fallback path, not the
 * primary one, so determinism matters more than nuance here.
 */
export function templateSummary(facts: WeekSummaryFacts): string {
  const parts: string[] = [];

  if (facts.now) {
    parts.push(`Now: ${facts.now.name} (${formatHHMM(facts.now.startMinutes)}–${formatHHMM(facts.now.endMinutes)}).`);
  } else if (facts.next.length > 0) {
    parts.push(`Nothing scheduled right now — next up: ${facts.next[0].name} at ${formatHHMM(facts.next[0].startMinutes)}.`);
  } else {
    parts.push("Nothing scheduled right now.");
  }

  if (facts.next.length > 0) {
    parts.push(`Next: ${facts.next.map((b) => `${b.name} (${formatHHMM(b.startMinutes)}–${formatHHMM(b.endMinutes)})`).join(", ")}.`);
  }

  parts.push(
    `Today: ${facts.today.plannedHours.toFixed(1)}h planned of ${facts.today.capacityHours.toFixed(1)}h, ${facts.today.doneHours.toFixed(1)}h done.`
  );

  if (facts.atRisk.length > 0) {
    parts.push(`At risk: ${facts.atRisk.join("; ")}.`);
  }

  const topThreeNote = facts.nextWeek.topThree.length > 0 ? `, top: ${facts.nextWeek.topThree.join(", ")}` : "";
  const cannotFitNote = facts.nextWeek.cannotFit.length > 0 ? `; couldn't fit: ${facts.nextWeek.cannotFit.join(", ")}` : "";
  parts.push(
    `Next week: ${facts.nextWeek.plannedHours.toFixed(1)}h planned of ${facts.nextWeek.capacityHours.toFixed(1)}h${topThreeNote}${cannotFitNote}.`
  );

  if (facts.monday) {
    const leftOutNote = facts.monday.leftOut.length > 0 ? `; left out: ${facts.monday.leftOut.join(", ")}` : "";
    parts.push(`This week has ${facts.monday.workingHours.toFixed(1)} working hours${leftOutNote}.`);
  }

  return parts.join(" ");
}
