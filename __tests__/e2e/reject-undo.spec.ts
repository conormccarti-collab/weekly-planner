import { test, expect } from "@playwright/test";
import { assertNoRealDataTouched, createFixtureBlocks, deleteFixtures, nextWeekMonday, type FixtureHandle } from "./fixtures";

/**
 * v5 Stage 12e.1 / V5-03: "Reject removes the block, records it, returns
 * the task to Unplaced with a reason, and regeneration does not restore
 * it." Fixtures only — this used to grab "the first placed block on the
 * page", whatever real task that happened to be, which made it flaky
 * whenever the dev project's real data had nothing placed at all.
 *
 * Week-list rebuild: there is no more inline click-to-expand editor — the
 * block's Edit button opens EditEntryModal, whose "Remove from calendar" is
 * this feature's entry point now (the old grid's "Reject"/"Remove" label on
 * an unaccepted vs. accepted week collapses to one label, since there's no
 * more accepted/draft distinction).
 */
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

test.describe("reject and undo", () => {
  test.beforeEach(async ({ page }) => {
    // Without this, a real background sync can complete mid-test and
    // trigger an unrelated regen that touches real plan_items rows — this
    // was the actual cause of an earlier "Undo doesn't stick" symptom (see
    // the session notes): Undo itself was correct, a later, unblocked sync
    // from this very file (it was the one spec missing this block) was what
    // touched things afterward.
    await page.route("**/api/sync/**", (route) => route.abort());
  });

  test("rejecting a block removes it, shows it in Unscheduled with its reason, and Undo restores it", async ({ page }) => {
    const weekStart = nextWeekMonday();
    const day = addDays(weekStart, 3); // Thursday — clear of real auto-placed content
    let fixtures: FixtureHandle[] = [];
    const since = new Date();
    try {
      fixtures = await createFixtureBlocks(weekStart, [{ name: "Reject Me", day, startMinutes: 570, endMinutes: 600 }]);
      const [fixture] = fixtures;

      await page.goto("/");
      await page.getByRole("button", { name: "Next week" }).click(); // fixtures land on nextWeekMonday(), the second tab
      const block = page.locator(`[data-plan-block="${fixture.blockId}"]`);
      await block.getByRole("button", { name: "Edit" }).click();
      await page.getByRole("button", { name: "Remove from calendar" }).click();

      await expect(page.getByText(/^Removed /)).toBeVisible();
      await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();

      // The heading's own parent is just the header row (heading + Auto-Schedule button);
      // the <ul> is a sibling of that row one level further up.
      const unplacedSection = page.getByRole("heading", { name: /^Unscheduled/ }).locator("..").locator("..");
      await expect(unplacedSection.getByText(fixture.name, { exact: false }).first()).toBeVisible();
      await expect(unplacedSection.getByText("Rejected", { exact: false })).toBeVisible();

      await page.getByRole("button", { name: "Undo" }).click();
      await expect(page.getByText(/^Removed /)).toHaveCount(0);
    } finally {
      try {
        await assertNoRealDataTouched(since, fixtures.map((f) => f.taskId));
      } finally {
        await deleteFixtures(fixtures);
      }
    }
  });
});
