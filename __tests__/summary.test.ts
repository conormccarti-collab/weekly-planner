import { describe, expect, it } from "vitest";
import { buildWeekSummaryFacts, templateSummary } from "@/lib/summary";
import type { WeekViewData } from "@/lib/week-view-data";
import type { PlannerTask, Placement } from "@/lib/planner-types";
import type { Weekday } from "@/lib/time";

const MON_TO_FRI: Weekday[] = ["mon", "tue", "wed", "thu", "fri"];

function makePlacement(overrides: Partial<Placement> = {}): Placement {
  return {
    id: "p1",
    day: "2026-11-16",
    startMinutes: 9 * 60,
    endMinutes: 10 * 60,
    hours: 1,
    actualHours: null,
    status: "planned",
    isFinal: false,
    pinned: false,
    ...overrides,
  };
}

function makeTask(overrides: Partial<PlannerTask> = {}): PlannerTask {
  return {
    source: "asana",
    reference: "gid1",
    rootRef: "gid1",
    name: "Task",
    parentName: null,
    projectName: "Project",
    dueOn: null,
    rootDueOn: null,
    priority: null,
    stage: null,
    focusType: "shallow",
    focusLabel: null,
    videoType: null,
    brand: null,
    fixedZeroHours: false,
    estimateHours: 1,
    estimateDisplay: "1h",
    must: false,
    placements: [],
    isBlocked: false,
    ...overrides,
  };
}

function makeData(overrides: Partial<WeekViewData> = {}): WeekViewData {
  return {
    asanaStatus: { lastSyncedAt: null, lastSyncError: null },
    calendarStatus: { lastSyncedAt: null, lastSyncError: null },
    capacityDays: [
      {
        dateStr: "2026-11-16",
        weekday: "mon",
        isWorkingDay: true,
        startLabel: "09:00",
        startIsActual: false,
        windowStartMinutes: 9 * 60,
        windowEndMinutes: 17 * 60,
        capacityHours: 7,
        plannedCapacityHours: 7,
        freeBlocks: [],
        events: [],
      },
    ],
    followingCapacityDays: [],
    thisWeekTasks: [],
    everythingElseGroups: [],
    parkedKeys: new Set(),
    todayStr: "2026-11-16",
    weekStart: "2026-11-16",
    followingWeekStart: "2026-11-23",
    weekStatus: "saved",
    weekCapacityHours: 35,
    weekPlannedHours: 0,
    weekSuggestedHours: 0,
    weekHygieneIssues: [],
    startsThisWeek: [],
    breakdown: [],
    saveRefs: [],
    shoots: [],
    rejectedKeys: new Set(),
    thisWeekOnlyKeys: new Set(),
    workingDays: MON_TO_FRI,
    followingWeekUnplaced: [],
    followingWeekTopRanked: [],
    followingWeekPlannedHours: 0,
    followingWeekCapacityHours: 35,
    ...overrides,
  };
}

describe("buildWeekSummaryFacts", () => {
  it("finds the current block by the clock", () => {
    const task = makeTask({ name: "Edit the Arran video", placements: [makePlacement({ startMinutes: 9 * 60, endMinutes: 11 * 60 })] });
    const facts = buildWeekSummaryFacts(makeData({ thisWeekTasks: [task] }), MON_TO_FRI, 10 * 60);
    expect(facts.now).toEqual({ name: "Edit the Arran video", startMinutes: 540, endMinutes: 660 });
  });

  it("is outside any block when nothing covers the clock, and still lists next", () => {
    const task = makeTask({ name: "Later task", placements: [makePlacement({ startMinutes: 14 * 60, endMinutes: 15 * 60 })] });
    const facts = buildWeekSummaryFacts(makeData({ thisWeekTasks: [task] }), MON_TO_FRI, 10 * 60);
    expect(facts.now).toBeNull();
    expect(facts.next).toEqual([{ name: "Later task", startMinutes: 840, endMinutes: 900 }]);
  });

  it("lists up to the next two blocks today, in order", () => {
    const task = makeTask({
      name: "T",
      placements: [
        makePlacement({ id: "a", startMinutes: 13 * 60, endMinutes: 14 * 60 }),
        makePlacement({ id: "b", startMinutes: 11 * 60, endMinutes: 12 * 60 }),
        makePlacement({ id: "c", startMinutes: 15 * 60, endMinutes: 16 * 60 }),
      ],
    });
    const facts = buildWeekSummaryFacts(makeData({ thisWeekTasks: [task] }), MON_TO_FRI, 10 * 60);
    expect(facts.next.map((b) => b.startMinutes)).toEqual([11 * 60, 13 * 60]);
  });

  it("computes today's planned vs capacity and done hours", () => {
    const task = makeTask({
      placements: [
        makePlacement({ id: "a", startMinutes: 9 * 60, endMinutes: 10 * 60, hours: 1, status: "done", actualHours: 1.5 }),
        makePlacement({ id: "b", startMinutes: 11 * 60, endMinutes: 12 * 60, hours: 1 }),
      ],
    });
    const facts = buildWeekSummaryFacts(makeData({ thisWeekTasks: [task] }), MON_TO_FRI, 13 * 60);
    expect(facts.today).toEqual({ plannedHours: 2, capacityHours: 7, doneHours: 1.5, zeroCapacityReason: null });
  });

  it("flags a block that ended without being marked done, excluding done/behind", () => {
    const task = makeTask({
      name: "Review cut",
      placements: [
        makePlacement({ id: "ended-planned", startMinutes: 9 * 60, endMinutes: 10 * 60, status: "planned" }),
        makePlacement({ id: "ended-done", startMinutes: 9 * 60, endMinutes: 10 * 60, status: "done" }),
        makePlacement({ id: "ended-behind", startMinutes: 9 * 60, endMinutes: 10 * 60, status: "behind" }),
      ],
    });
    const facts = buildWeekSummaryFacts(makeData({ thisWeekTasks: [task] }), MON_TO_FRI, 11 * 60);
    expect(facts.endedNotDone.map((b) => b.blockId)).toEqual(["ended-planned"]);
  });

  it("flags a deadline within two working days", () => {
    const task = makeTask({ name: "Deliver cut", dueOn: "2026-11-18" });
    const facts = buildWeekSummaryFacts(makeData({ thisWeekTasks: [task] }), MON_TO_FRI, 9 * 60);
    expect(facts.atRisk).toContain("Deliver cut is within 2 working days");
  });

  it("omits the deadline fact when nothing is due soon", () => {
    const task = makeTask({ name: "Far off", dueOn: "2026-12-20" });
    const facts = buildWeekSummaryFacts(makeData({ thisWeekTasks: [task] }), MON_TO_FRI, 9 * 60);
    expect(facts.atRisk).toEqual([]);
  });

  it("v5 Stage 12f.2: an overdue task says 'overdue by N days', not 'within 2 working days'", () => {
    const task = makeTask({ name: "Old deliverable", dueOn: "2026-11-01" }); // today is 2026-11-16
    const facts = buildWeekSummaryFacts(makeData({ thisWeekTasks: [task] }), MON_TO_FRI, 9 * 60);
    expect(facts.atRisk).toContain("Old deliverable is overdue by 15 days");
  });

  it("v5 Stage 12f.3: an at-risk subtask shows its parent film name", () => {
    const task = makeTask({ name: "Edit", parentName: "Arran Trip Video", dueOn: "2026-11-18" });
    const facts = buildWeekSummaryFacts(makeData({ thisWeekTasks: [task] }), MON_TO_FRI, 9 * 60);
    expect(facts.atRisk).toContain("Arran Trip Video — Edit is within 2 working days");
  });

  it("v5 Stage 12f.3: the same task due soon in both thisWeekTasks and everythingElseGroups is merged, not duplicated", () => {
    const task = makeTask({ name: "Edit", dueOn: "2026-11-18" });
    const facts = buildWeekSummaryFacts(
      makeData({
        thisWeekTasks: [task],
        everythingElseGroups: [
          { rootRef: "root", rootName: "root", projectName: "P", isContainer: false, nothingLeftToPlan: false, seriesName: null, tasks: [task] },
        ],
      }),
      MON_TO_FRI,
      9 * 60
    );
    expect(facts.atRisk.filter((line) => line.startsWith("Edit"))).toHaveLength(1);
  });

  it("v5 Stage 12f.4: a non-working day says why instead of '0.0h of 0.0h'", () => {
    const facts = buildWeekSummaryFacts(
      makeData({
        capacityDays: [
          {
            dateStr: "2026-11-16",
            weekday: "mon",
            isWorkingDay: false,
            startLabel: "",
            startIsActual: false,
            windowStartMinutes: 0,
            windowEndMinutes: 0,
            capacityHours: 0,
            plannedCapacityHours: 0,
            freeBlocks: [],
            events: [],
          },
        ],
      }),
      MON_TO_FRI,
      9 * 60
    );
    expect(facts.today.zeroCapacityReason).toBe("Not a working day");
  });

  it("v5 Stage 12f.4: a working day blocked by an all-day leave event names it and says when capacity resumes", () => {
    const facts = buildWeekSummaryFacts(
      makeData({
        capacityDays: [
          {
            dateStr: "2026-11-16",
            weekday: "mon",
            isWorkingDay: true,
            startLabel: "09:00",
            startIsActual: false,
            windowStartMinutes: 9 * 60,
            windowEndMinutes: 17 * 60,
            capacityHours: 7,
            plannedCapacityHours: 0,
            freeBlocks: [],
            events: [{ id: "e1", title: "Annual Leave", allDay: true, busy: true, startLabel: null, endLabel: null }],
          },
          {
            dateStr: "2026-11-17",
            weekday: "tue",
            isWorkingDay: true,
            startLabel: "09:00",
            startIsActual: false,
            windowStartMinutes: 9 * 60,
            windowEndMinutes: 17 * 60,
            capacityHours: 7,
            plannedCapacityHours: 7,
            freeBlocks: [],
            events: [],
          },
        ],
      }),
      MON_TO_FRI,
      9 * 60
    );
    expect(facts.today.zeroCapacityReason).toBe("Annual Leave until 17 Nov");
  });

  it("flags over capacity with the exact overage", () => {
    const facts = buildWeekSummaryFacts(makeData({ weekPlannedHours: 40, weekCapacityHours: 35 }), MON_TO_FRI, 9 * 60);
    expect(facts.atRisk).toContain("This week is 5.0h over capacity");
  });

  it("counts tasks that still need an estimate — a placed suggested task doesn't count, only an unplaced one with no figure at all", () => {
    const suggested = makeTask({ placements: [makePlacement({ status: "suggested" })] });
    const noEstimate = makeTask({ reference: "gid2", placements: [], estimateHours: null });
    const facts = buildWeekSummaryFacts(makeData({ thisWeekTasks: [suggested, noEstimate] }), MON_TO_FRI, 9 * 60);
    expect(facts.atRisk).toContain("1 task still needs an estimate");
  });

  it("lists suggested-estimate tasks separately from the needs-estimate count", () => {
    const suggested = makeTask({ name: "Suggested task", placements: [makePlacement({ status: "suggested" })] });
    const facts = buildWeekSummaryFacts(makeData({ thisWeekTasks: [suggested] }), MON_TO_FRI, 9 * 60);
    expect(facts.week.suggestedEstimateTasks).toEqual(["Suggested task"]);
  });

  it("lists this-week tasks that didn't fit, with a reason", () => {
    const needsEstimate = makeTask({ name: "No figure", reference: "gid2", placements: [], estimateHours: null });
    const noRoom = makeTask({ name: "No room", reference: "gid3", placements: [], estimateHours: 3 });
    const facts = buildWeekSummaryFacts(makeData({ thisWeekTasks: [needsEstimate, noRoom] }), MON_TO_FRI, 9 * 60);
    expect(facts.week.notFit).toEqual([
      { name: "No figure", reason: "needs an estimate" },
      { name: "No room", reason: "no room left this week" },
    ]);
  });

  it("passes through this week's capacity/planned/free-or-over and hygiene issues", () => {
    const facts = buildWeekSummaryFacts(
      makeData({ weekCapacityHours: 35, weekPlannedHours: 20, weekHygieneIssues: ["Arran edit: Brand is blank"] }),
      MON_TO_FRI,
      9 * 60
    );
    expect(facts.week.capacityHours).toBe(35);
    expect(facts.week.plannedHours).toBe(20);
    expect(facts.week.freeOrOverHours).toBe(15);
    expect(facts.week.hygieneIssues).toEqual(["Arran edit: Brand is blank"]);
  });

  it("surfaces next week's planned/capacity, top three, and cannot-fit list unchanged", () => {
    const facts = buildWeekSummaryFacts(
      makeData({
        followingWeekPlannedHours: 20,
        followingWeekCapacityHours: 35,
        followingWeekTopRanked: [{ source: "asana", reference: "g1", name: "Top task" }],
        followingWeekUnplaced: [{ source: "asana", reference: "g2", name: "Overflow task" }],
      }),
      MON_TO_FRI,
      9 * 60
    );
    expect(facts.nextWeek).toEqual({ plannedHours: 20, capacityHours: 35, topThree: ["Top task"], cannotFit: ["Overflow task"] });
  });

  it("includes the Monday extra only on the week's Monday", () => {
    const monday = buildWeekSummaryFacts(
      makeData({ todayStr: "2026-11-16", weekStart: "2026-11-16", followingWeekUnplaced: [{ source: "asana", reference: "g1", name: "Left out" }] }),
      MON_TO_FRI,
      9 * 60
    );
    expect(monday.monday).toEqual({ workingHours: 35, leftOut: ["Left out"] });

    const tuesday = buildWeekSummaryFacts(makeData({ todayStr: "2026-11-17", weekStart: "2026-11-16" }), MON_TO_FRI, 9 * 60);
    expect(tuesday.monday).toBeNull();
  });
});

describe("templateSummary", () => {
  it("never invents a number — every figure comes straight from the facts object", () => {
    const task = makeTask({ name: "Edit the cut", placements: [makePlacement({ startMinutes: 9 * 60, endMinutes: 11 * 60 })] });
    const facts = buildWeekSummaryFacts(
      makeData({ thisWeekTasks: [task], weekPlannedHours: 40, weekCapacityHours: 35 }),
      MON_TO_FRI,
      10 * 60
    );
    const text = templateSummary(facts);
    expect(text).toContain("Edit the cut (09:00–11:00)");
    expect(text).toContain("This week is 5.0h over capacity");
  });

  it("omits the At risk sentence entirely when nothing is at risk", () => {
    const facts = buildWeekSummaryFacts(makeData(), MON_TO_FRI, 9 * 60);
    expect(templateSummary(facts)).not.toContain("At risk");
  });

  it("says nothing is scheduled when there is no current or next block", () => {
    const facts = buildWeekSummaryFacts(makeData(), MON_TO_FRI, 9 * 60);
    expect(templateSummary(facts)).toContain("Nothing scheduled right now.");
  });
});
