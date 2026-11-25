import type { WeekViewData } from "@/lib/week-view-data";
import type { Weekday } from "@/lib/time";
import { addWorkingDays, daysBetweenDateStrs, formatHHMM } from "@/lib/time";
import { isStale } from "@/lib/stale";

/** v5 Stage 12f.2: "Overdue wording is 'overdue by N days'. 'Within 2 working days' applies only to future dates." */
export function dueWording(dueOn: string, todayStr: string): string {
  const diff = daysBetweenDateStrs(dueOn, todayStr); // positive => dueOn is in the past
  if (diff > 0) return `overdue by ${diff} day${diff === 1 ? "" : "s"}`;
  if (diff === 0) return "due today";
  return "within 2 working days"; // the caller only ever includes a future date already gated to this window
}

/** v5 Stage 12f.3: "Every subtask shows its parent" — the summary's own task-name formatting. */
export function displayName(name: string, parentName: string | null): string {
  return parentName ? `${parentName} — ${name}` : name;
}

/** v5 Stage 12f.1: short dates ("24 Jul") instead of a full ISO string. */
export function shortDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const month = date.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
  return `${d} ${month}`;
}

type DayForZeroCapacity = { dateStr: string; isWorkingDay: boolean; plannedCapacityHours: number; events: { title: string; allDay: boolean }[] };

/**
 * v5 Stage 12f.4: "Zero-capacity weeks say why... never print '0.0h of
 * 0.0h'." Looks across every day already loaded for when capacity resumes —
 * never guesses past that window. `anchorDay` is the specific zero-capacity
 * day being explained (today, or the week's first working day).
 */
function zeroCapacityReasonFor(anchorDay: DayForZeroCapacity | undefined, allDays: DayForZeroCapacity[]): string | null {
  if (!anchorDay || anchorDay.plannedCapacityHours > 0) return null;
  if (!anchorDay.isWorkingDay) return "Not a working day";
  const allDayEvent = anchorDay.events.find((e) => e.allDay);
  const resumesDay = allDays.find((d) => d.dateStr > anchorDay.dateStr && d.plannedCapacityHours > 0);
  const until = resumesDay ? ` until ${shortDate(resumesDay.dateStr)}` : "";
  return allDayEvent ? `${allDayEvent.title}${until}` : `You're out${until || " for the rest of this week"}`;
}

export type SummaryBlock = { name: string; startMinutes: number; endMinutes: number };

export type EndedNotDoneBlock = {
  blockId: string;
  source: "asana" | "personal";
  reference: string;
  name: string;
  /** v5 Stage 12e.5: "Parent names on every subtask wherever a subtask is shown." */
  parentName: string | null;
  startMinutes: number;
  endMinutes: number;
  plannedHours: number;
};

export type WeekSummaryFacts = {
  now: SummaryBlock | null;
  next: SummaryBlock[];
  today: {
    plannedHours: number;
    capacityHours: number;
    doneHours: number;
    /** v5 Stage 12f.4: "Zero-capacity weeks say why... never print '0.0h of 0.0h'." Null when there's genuinely nothing to explain (capacity > 0). */
    zeroCapacityReason: string | null;
  };
  /** Fully-computed fact lines (deadlines, over-capacity, needs-estimate) — a model may only phrase these, never invent numbers. Omit the section entirely if empty. */
  atRisk: string[];
  /** Rendered as fixed-format one-tap prompts, not through the model (brief 7, "How it works" bullet 3). */
  endedNotDone: EndedNotDoneBlock[];
  /**
   * v4 Stage 2, brief 5.6: "about six lines for the week" — capacity,
   * hours placed, hours free or over, the main thing at risk, tasks that
   * did not fit and why, tasks using suggested estimates, hygiene problems
   * on this week's deliverables. Kept separate from `atRisk` above (the
   * Now/Next/Today/At-risk strip stays as it was) — this is the fuller,
   * once-a-day-ish summary, not the live strip.
   */
  week: {
    capacityHours: number;
    plannedHours: number;
    /** Positive = hours still free; negative = hours over capacity. */
    freeOrOverHours: number;
    mainAtRisk: string | null;
    /** v5 Stage 12f.3: "'Didn't fit' names the task, film, hours and reason." `hours` is null only when the reason itself is the missing estimate. */
    notFit: { name: string; hours: number | null; reason: string }[];
    suggestedEstimateTasks: string[];
    hygieneIssues: string[];
    /** v5 Stage 12f.4: same as today's, for a week with zero capacity throughout (e.g. a full week of leave). */
    zeroCapacityReason: string | null;
  };
  /** v4 Stage 2, brief 5.6: "three lines for next week" — planned-vs-capacity, top three, cannot-fit. */
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
        parentName: task.parentName,
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

  const todayDay = data.capacityDays.find((d) => d.dateStr === todayStr);
  const todayCapacity = todayDay?.plannedCapacityHours ?? 0;
  const todayPlannedHours = todayEntries.reduce((sum, e) => sum + e.plannedHours, 0);
  const todayDoneHours = todayEntries.reduce((sum, e) => sum + (e.status === "done" && e.actualHours != null ? e.actualHours : 0), 0);

  const allDays = [...data.capacityDays, ...data.followingCapacityDays];
  const zeroCapacityReason = zeroCapacityReasonFor(todayDay, allDays);
  const weekZeroCapacityReason =
    data.weekCapacityHours === 0 ? zeroCapacityReasonFor(data.capacityDays.find((d) => d.isWorkingDay) ?? data.capacityDays[0], allDays) : null;

  const endedNotDone: EndedNotDoneBlock[] = todayEntries
    .filter((e) => e.endMinutes <= nowMinutes && e.status !== "done" && e.status !== "behind")
    .map(({ status: _status, actualHours: _actualHours, ...block }) => block);

  const atRisk: string[] = [];

  // v5 Stage 12f.3: "Every subtask shows its parent... Duplicates merged" —
  // a task can appear via both thisWeekTasks and everythingElseGroups
  // (e.g. due this week but genuinely unplaced), so dedupe by key first.
  // v5 Stage 12d.4 fix: a task overdue by more than 14 days is Stale, not
  // At risk — "not placed, not At risk." The gate at group-build time only
  // catches a stale *deliverable* (root due date); a deliverable with no
  // publish date at all can still have one genuinely stale subtask (its
  // own internal due date, long past), which must be excluded here too,
  // not just reworded.
  const deadlineCutoff = addWorkingDays(todayStr, 2, workingDays);
  const atRiskByKey = new Map<string, { name: string; parentName: string | null; dueOn: string }>();
  for (const t of [...data.thisWeekTasks, ...data.everythingElseGroups.flatMap((g) => g.tasks)]) {
    if (t.dueOn == null || t.dueOn > deadlineCutoff) continue;
    if (isStale(t.dueOn, todayStr)) continue;
    atRiskByKey.set(`${t.source}:${t.reference}`, { name: t.name, parentName: t.parentName, dueOn: t.dueOn });
  }
  for (const t of atRiskByKey.values()) {
    atRisk.push(`${displayName(t.name, t.parentName)} is ${dueWording(t.dueOn, todayStr)}`);
  }

  if (data.weekPlannedHours > data.weekCapacityHours) {
    atRisk.push(`This week is ${(data.weekPlannedHours - data.weekCapacityHours).toFixed(1)}h over capacity`);
  }

  const needsEstimateCount = data.thisWeekTasks.filter(
    (t) => t.placements.length === 0 && t.estimateHours == null && !t.estimateAmbiguousOptions?.length
  ).length;
  if (needsEstimateCount > 0) {
    atRisk.push(`${needsEstimateCount} task${needsEstimateCount === 1 ? "" : "s"} still need${needsEstimateCount === 1 ? "s" : ""} an estimate`);
  }

  const isMonday = todayStr === data.weekStart;
  const monday = isMonday ? { workingHours: data.weekCapacityHours, leftOut: data.followingWeekUnplaced.map((u) => u.name) } : null;

  const notFit = data.thisWeekTasks
    .filter((t) => t.placements.length === 0)
    .map((t) => ({
      name: displayName(t.name, t.parentName),
      hours: t.estimateHours,
      reason: t.estimateHours == null ? "needs an estimate" : "no room left this week",
    }));
  const suggestedEstimateTasks = data.thisWeekTasks
    .filter((t) => t.placements.some((p) => p.status === "suggested"))
    .map((t) => displayName(t.name, t.parentName));

  return {
    now,
    next,
    today: { plannedHours: todayPlannedHours, capacityHours: todayCapacity, doneHours: todayDoneHours, zeroCapacityReason },
    atRisk,
    endedNotDone,
    week: {
      capacityHours: data.weekCapacityHours,
      plannedHours: data.weekPlannedHours,
      freeOrOverHours: data.weekCapacityHours - data.weekPlannedHours,
      mainAtRisk: atRisk[0] ?? null,
      notFit,
      suggestedEstimateTasks,
      hygieneIssues: data.weekHygieneIssues,
      zeroCapacityReason: weekZeroCapacityReason,
    },
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
 * Renders the same facts `WeekSummary` (components/week-summary.tsx) shows
 * as a static card, as plain text for the chat — presented as the first
 * message of the day there instead, per the user's preference. Markdown
 * matches the convention `components/chat-markdown.tsx` renders: a bold
 * label per line, "- " bullets for a multi-line section. No model call, no
 * invented numbers — exactly the facts already computed.
 */
export function formatDailySummaryText(facts: WeekSummaryFacts): string {
  const lines: string[] = [];

  if (facts.now) {
    lines.push(`**Now:** ${facts.now.name} (${formatHHMM(facts.now.startMinutes)}–${formatHHMM(facts.now.endMinutes)})`);
  } else if (facts.next.length > 0) {
    lines.push(`**Now:** Nothing right now — next: ${facts.next[0].name} at ${formatHHMM(facts.next[0].startMinutes)}`);
  } else {
    lines.push(`**Now:** Nothing scheduled right now`);
  }

  if (facts.next.length > 0) {
    lines.push(`**Next:**`);
    lines.push(...facts.next.map((b) => `- ${b.name} (${formatHHMM(b.startMinutes)}–${formatHHMM(b.endMinutes)})`));
  }

  lines.push(
    facts.today.zeroCapacityReason
      ? `**Today:** ${facts.today.zeroCapacityReason}`
      : `**Today:** ${facts.today.plannedHours.toFixed(1)}h planned of ${facts.today.capacityHours.toFixed(1)}h, ${facts.today.doneHours.toFixed(1)}h done`
  );

  if (facts.atRisk.length > 0) {
    lines.push(`**At risk:**`);
    lines.push(...facts.atRisk.map((l) => `- ${l}`));
  }

  const freeOrOver =
    facts.week.freeOrOverHours >= 0 ? `${facts.week.freeOrOverHours.toFixed(1)}h free` : `${Math.abs(facts.week.freeOrOverHours).toFixed(1)}h over`;
  lines.push(
    facts.week.zeroCapacityReason
      ? `**This week:** ${facts.week.zeroCapacityReason}`
      : `**This week:** ${facts.week.plannedHours.toFixed(1)}h placed of ${facts.week.capacityHours.toFixed(1)}h capacity, ${freeOrOver}`
  );
  if (facts.monday) {
    lines.push(
      `${facts.monday.workingHours.toFixed(1)}h of working hours this week` +
        (facts.monday.leftOut.length > 0 ? ` — left out of next week: ${facts.monday.leftOut.join(", ")}` : "")
    );
  }

  if (facts.week.notFit.length > 0) {
    lines.push(`**Didn't fit:**`);
    lines.push(...facts.week.notFit.map((n) => `- ${n.name}${n.hours != null ? ` — ${n.hours}h` : ""} — ${n.reason}`));
  }

  if (facts.week.suggestedEstimateTasks.length > 0) {
    lines.push(`**Suggested estimates:**`);
    lines.push(...facts.week.suggestedEstimateTasks.map((n) => `- ${n}`));
  }

  if (facts.week.hygieneIssues.length > 0) {
    lines.push(
      `**Hygiene:** ${facts.week.hygieneIssues.length} issue${facts.week.hygieneIssues.length === 1 ? "" : "s"} — top three: ${facts.week.hygieneIssues.slice(0, 3).join("; ")}`
    );
  }

  lines.push(
    `**Next week:** ${facts.nextWeek.plannedHours.toFixed(1)}h planned of ${facts.nextWeek.capacityHours.toFixed(1)}h capacity` +
      (facts.nextWeek.topThree.length > 0 ? ` — top: ${facts.nextWeek.topThree.join(", ")}` : "") +
      (facts.nextWeek.cannotFit.length > 0 ? ` — couldn't fit: ${facts.nextWeek.cannotFit.join(", ")}` : "")
  );

  return lines.join("\n");
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

  if (facts.today.zeroCapacityReason) {
    parts.push(`Today: ${facts.today.zeroCapacityReason}.`);
  } else {
    parts.push(
      `Today: ${facts.today.plannedHours.toFixed(1)}h planned of ${facts.today.capacityHours.toFixed(1)}h, ${facts.today.doneHours.toFixed(1)}h done.`
    );
  }

  if (facts.atRisk.length > 0) {
    parts.push(`At risk: ${facts.atRisk.join("; ")}.`);
  }

  // v4 Stage 2, brief 5.6: the fuller ~6-line week summary, kept separate
  // from the Now/Next/Today/At-risk strip above.
  if (facts.week.zeroCapacityReason) {
    parts.push(`This week: ${facts.week.zeroCapacityReason}.`);
  } else {
    const freeOrOver =
      facts.week.freeOrOverHours >= 0 ? `${facts.week.freeOrOverHours.toFixed(1)}h free` : `${Math.abs(facts.week.freeOrOverHours).toFixed(1)}h over`;
    parts.push(`This week: ${facts.week.plannedHours.toFixed(1)}h placed of ${facts.week.capacityHours.toFixed(1)}h capacity, ${freeOrOver}.`);
  }
  if (facts.week.mainAtRisk) {
    parts.push(`Main thing at risk: ${facts.week.mainAtRisk}.`);
  }
  if (facts.week.notFit.length > 0) {
    parts.push(`Didn't fit: ${facts.week.notFit.map((n) => `${n.name}${n.hours != null ? `, ${n.hours}h` : ""} (${n.reason})`).join(", ")}.`);
  }
  if (facts.week.suggestedEstimateTasks.length > 0) {
    parts.push(`Using a suggested estimate: ${facts.week.suggestedEstimateTasks.join(", ")}.`);
  }
  if (facts.week.hygieneIssues.length > 0) {
    parts.push(`Hygiene: ${facts.week.hygieneIssues.join("; ")}.`);
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

  return parts.join("\n");
}
