import { test, expect } from "@playwright/test";
import {
  assertNoRealDataTouched,
  createFixtureBlocks,
  createFixtureMeeting,
  createUnplacedFixture,
  deleteFixtureMeeting,
  deleteFixtures,
  getFixtureTaskRows,
  nextWeekMonday,
  type FixtureHandle,
} from "./fixtures";

/**
 * Week-list rebuild: dragging is gone. The two ways to change anything are
 * the Edit button on a placed entry (opens EditEntryModal) and the Place…
 * button on an unscheduled task (opens PlaceModal) — both still call the
 * same resolveDrop-backed engine (moveBlock/placeBlock) a drag used to, so
 * the same push/redirect/split behaviour needs the same end-to-end proof,
 * just driven through the modals instead of a pointer. Absorbs and extends
 * the former tap-alternatives.spec.ts (the two overflow-split cases) plus
 * the push/meeting-redirect coverage the deleted drag specs used to carry.
 */

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

async function waitForRowCount(
  taskId: string,
  predicate: (rows: Awaited<ReturnType<typeof getFixtureTaskRows>>) => boolean,
  timeoutMs = 5000
) {
  const start = Date.now();
  let rows = await getFixtureTaskRows(taskId);
  while (!predicate(rows) && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 200));
    rows = await getFixtureTaskRows(taskId);
  }
  return rows;
}

test.describe("edit and place modals", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/sync/**", (route) => route.abort());
  });

  test("opening the editor on a non-round-duration block (3.5h) shows 3.5h selected, not the first preset", async ({ page }) => {
    const weekStart = nextWeekMonday();
    const day = addDays(weekStart, 3); // Thursday
    let fixtures: FixtureHandle[] = [];
    const since = new Date();
    try {
      fixtures = await createFixtureBlocks(weekStart, [{ name: "Odd Duration", day, startMinutes: 570, endMinutes: 780 }]); // 09:30-13:00, 3.5h
      const [block] = fixtures;

      await page.goto("/");
      await page.getByRole("button", { name: "Next week" }).click(); // fixtures land on nextWeekMonday(), the second tab
      await page.locator(`[data-plan-block="${block.blockId}"]`).getByRole("button", { name: "Edit" }).click();

      const durationSelect = page.getByRole("combobox").filter({ hasText: "3.5h" });
      await expect(durationSelect).toHaveValue("210"); // 3.5h in minutes
    } finally {
      try {
        await assertNoRealDataTouched(since, fixtures.map((f) => f.taskId));
      } finally {
        await deleteFixtures(fixtures);
      }
    }
  });

  test("Place… picker: splits across days when the chosen duration runs past the end of the day", async ({ page }) => {
    const weekStart = nextWeekMonday();
    const day1 = addDays(weekStart, 3); // Thursday — clear of real auto-placed content
    const day2 = addDays(weekStart, 4); // Friday
    let unplaced: FixtureHandle | null = null;
    const since = new Date();
    try {
      unplaced = await createUnplacedFixture(weekStart, "Tap Place Overflow");

      await page.goto("/");
      await page.getByRole("button", { name: "Next week" }).click(); // so day1/day2's day cards are on screen to read window-end from
      // The heading's own parent is just the header row (heading + Auto-Schedule button);
      // the <ul> is a sibling of that row one level further up.
      const unplacedSection = page.getByRole("heading", { name: /^Unscheduled/ }).locator("..").locator("..");
      const row = unplacedSection.locator("li", { hasText: unplaced.name });
      await expect(row).toBeVisible();
      await row.getByRole("button", { name: "Place…" }).click();

      await page.getByLabel("Day").selectOption(day1);

      const dayCard = page.locator(`[data-day-card="${day1}"]`);
      await expect(dayCard).toBeVisible();
      const windowEnd = Number(await dayCard.getAttribute("data-window-end"));
      const dropStart = windowEnd - 60; // only 1h of the chosen 3h fits before end of day

      await page.getByLabel("Start time").selectOption(String(dropStart));
      await page.getByLabel("Duration").selectOption(String(180)); // 3h
      await page.getByRole("button", { name: "Place", exact: true }).click();

      const rows = await waitForRowCount(unplaced.taskId, (r) => r.length === 2, 5000);
      expect(rows.length, "expected the placed block to split across the day boundary, not error out or overflow").toBe(2);

      const today = rows.find((r) => r.day === day1);
      const tomorrow = rows.find((r) => r.day === day2);
      expect(today, "today's part is missing").toBeTruthy();
      expect(tomorrow, "no part landed on the next working day").toBeTruthy();
      expect(today).toEqual(expect.objectContaining({ day: day1, startMinutes: dropStart, endMinutes: windowEnd, pinned: true }));
      const totalMinutes = (today!.endMinutes! - today!.startMinutes!) + (tomorrow!.endMinutes! - tomorrow!.startMinutes!);
      expect(totalMinutes, "parts must sum to the full 3h duration").toBe(180);
    } finally {
      try {
        await assertNoRealDataTouched(since, unplaced ? [unplaced.taskId] : []);
      } finally {
        if (unplaced) await deleteFixtures([unplaced]);
      }
    }
  });

  test("edit modal's Save: splits across days when the edited duration runs past the end of the day", async ({ page }) => {
    const weekStart = nextWeekMonday();
    const day1 = addDays(weekStart, 3); // Thursday
    const day2 = addDays(weekStart, 4); // Friday
    let fixtures: FixtureHandle[] = [];
    const since = new Date();
    try {
      fixtures = await createFixtureBlocks(weekStart, [{ name: "Tap Edit Overflow", day: day1, startMinutes: 570, endMinutes: 630 }]); // 09:30-10:30, 1h
      const [block] = fixtures;

      await page.goto("/");
      await page.getByRole("button", { name: "Next week" }).click();
      await page.locator(`[data-plan-block="${block.blockId}"]`).getByRole("button", { name: "Edit" }).click();

      const dayCard = page.locator(`[data-day-card="${day1}"]`);
      const windowEnd = Number(await dayCard.getAttribute("data-window-end"));
      const dropStart = windowEnd - 60; // only 1h of the new 3h duration fits before end of day

      await page.getByLabel("Start time").selectOption(String(dropStart));
      await page.getByLabel("Duration").selectOption(String(180)); // 3h
      await page.getByRole("button", { name: "Save", exact: true }).click();

      const rows = await waitForRowCount(block.taskId, (r) => r.length === 2, 5000);
      expect(rows.length, "expected the edited block to split across the day boundary, not error out or overflow").toBe(2);

      const today = rows.find((r) => r.day === day1);
      const tomorrow = rows.find((r) => r.day === day2);
      expect(today, "today's part is missing").toBeTruthy();
      expect(tomorrow, "no part landed on the next working day").toBeTruthy();
      expect(today).toEqual(expect.objectContaining({ day: day1, startMinutes: dropStart, endMinutes: windowEnd }));
      const totalMinutes = (today!.endMinutes! - today!.startMinutes!) + (tomorrow!.endMinutes! - tomorrow!.startMinutes!);
      expect(totalMinutes, "parts must sum to the full 3h duration").toBe(180);
    } finally {
      try {
        await assertNoRealDataTouched(since, fixtures.map((f) => f.taskId));
      } finally {
        await deleteFixtures(fixtures);
      }
    }
  });

  test("editing a block onto an occupied slot pushes the occupant later instead of overlapping it", async ({ page }) => {
    const weekStart = nextWeekMonday();
    const day = addDays(weekStart, 3); // Thursday
    let fixtures: FixtureHandle[] = [];
    const since = new Date();
    try {
      fixtures = await createFixtureBlocks(weekStart, [
        { name: "Mover", day, startMinutes: 570, endMinutes: 600 }, // 09:30-10:00
        { name: "Occupant", day, startMinutes: 660, endMinutes: 720 }, // 11:00-12:00
      ]);
      const [mover, occupant] = fixtures;

      await page.goto("/");
      await page.getByRole("button", { name: "Next week" }).click();
      await page.locator(`[data-plan-block="${mover.blockId}"]`).getByRole("button", { name: "Edit" }).click();
      await page.getByLabel("Start time").selectOption("660"); // drop right on top of Occupant
      await page.getByRole("button", { name: "Save", exact: true }).click();

      const occupantRows = await waitForRowCount(occupant.taskId, (r) => r.length === 1 && r[0].startMinutes === 690);
      expect(occupantRows).toEqual([expect.objectContaining({ day, startMinutes: 690, endMinutes: 750 })]);

      const moverRows = await getFixtureTaskRows(mover.taskId);
      expect(moverRows).toEqual([expect.objectContaining({ day, startMinutes: 660, endMinutes: 690 })]);
    } finally {
      try {
        await assertNoRealDataTouched(since, fixtures.map((f) => f.taskId));
      } finally {
        await deleteFixtures(fixtures);
      }
    }
  });

  test("editing a block onto a meeting redirects to the nearest free slot instead of overlapping it", async ({ page }) => {
    const weekStart = nextWeekMonday();
    const day = addDays(weekStart, 4); // Friday
    let fixtures: FixtureHandle[] = [];
    let meeting: Awaited<ReturnType<typeof createFixtureMeeting>> | null = null;
    const since = new Date();
    try {
      fixtures = await createFixtureBlocks(weekStart, [{ name: "Redirect Me", day, startMinutes: 570, endMinutes: 630 }]); // 09:30-10:30
      meeting = await createFixtureMeeting(day, 660, 720); // 11:00-12:00
      const [block] = fixtures;

      await page.goto("/");
      await page.getByRole("button", { name: "Next week" }).click();
      await page.locator(`[data-plan-block="${block.blockId}"]`).getByRole("button", { name: "Edit" }).click();
      await page.getByLabel("Start time").selectOption("660"); // drop directly on the meeting
      await page.getByRole("button", { name: "Save", exact: true }).click();

      const rows = await waitForRowCount(block.taskId, (r) => r.length === 1 && r[0].startMinutes !== 570);
      expect(rows).toHaveLength(1);
      const [row] = rows;
      // Redirected somewhere that isn't the meeting itself.
      expect(row.startMinutes! < 660 || row.startMinutes! >= 720).toBe(true);
    } finally {
      try {
        if (meeting) await deleteFixtureMeeting(meeting);
      } finally {
        try {
          await assertNoRealDataTouched(since, fixtures.map((f) => f.taskId));
        } finally {
          await deleteFixtures(fixtures);
        }
      }
    }
  });

  test("placing an unscheduled task onto a free slot saves once, pins, and stays after reload", async ({ page }) => {
    const weekStart = nextWeekMonday();
    const targetDay = addDays(weekStart, 4); // Friday
    let unplaced: FixtureHandle | null = null;
    const since = new Date();
    try {
      unplaced = await createUnplacedFixture(weekStart, "Free Slot");

      await page.goto("/");
      await page.getByRole("button", { name: "Next week" }).click(); // so targetDay's day card is on screen after placing
      // The heading's own parent is just the header row (heading + Auto-Schedule button);
      // the <ul> is a sibling of that row one level further up.
      const unplacedSection = page.getByRole("heading", { name: /^Unscheduled/ }).locator("..").locator("..");
      const row = unplacedSection.locator("li", { hasText: unplaced.name });
      await expect(row).toBeVisible();
      await row.getByRole("button", { name: "Place…" }).click();
      await page.getByLabel("Day").selectOption(targetDay);
      await page.getByLabel("Start time").selectOption("600");
      await page.getByRole("button", { name: "Place", exact: true }).click();

      const rows = await waitForRowCount(unplaced.taskId, (r) => r.length === 1 && r[0].day === targetDay);
      expect(rows).toEqual([expect.objectContaining({ day: targetDay, pinned: true })]);

      await page.reload();
      const rowsAfterReload = await getFixtureTaskRows(unplaced.taskId);
      expect(rowsAfterReload).toEqual(rows);
    } finally {
      try {
        await assertNoRealDataTouched(since, unplaced ? [unplaced.taskId] : []);
      } finally {
        if (unplaced) await deleteFixtures([unplaced]);
      }
    }
  });
});
