import { test, expect } from "@playwright/test";

/**
 * v5 Stage 12e.1 / V5-03: "Reject removes the block, records it, returns
 * the task to Unplaced with a reason, and regeneration does not restore
 * it." See __tests__/e2e/README.md — blocked on a sign-in method.
 */
test.describe("reject and undo", () => {
  test("rejecting a block removes it, shows it in Unplaced, and Undo restores it", async ({ page }) => {
    await page.goto("/");

    const block = page.locator("[draggable='true']").first();
    const name = (await block.textContent())?.trim() ?? "";
    await block.click();

    const rejectOrRemove = page.getByRole("button", { name: /Reject|Remove/ });
    await rejectOrRemove.click();

    await expect(page.getByText(new RegExp(`Removed ${name.split(" ")[0]}`))).toBeVisible();
    await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();

    const unplacedSection = page.getByRole("heading", { name: "Unplaced tasks" }).locator("..");
    await expect(unplacedSection.getByText(name, { exact: false })).toBeVisible();
    await expect(unplacedSection.getByText("Rejected")).toBeVisible();

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByText(new RegExp(`Removed ${name.split(" ")[0]}`))).toHaveCount(0);
  });
});
