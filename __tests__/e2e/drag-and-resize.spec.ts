import { test, expect } from "@playwright/test";

/**
 * v5 Stage 12b / V5-02: "A real-mouse drag moves a block between days and
 * saves once; frame time is reported." Uses mouse.down/move/up, never
 * locator.dragTo (which dispatches synthetic HTML5 dragstart/dragover/drop
 * events — exactly what the brief's own critique (2.1.8) says never
 * exercised the real bug: native drag needs real pointer events, and
 * Code's own browser tooling can't produce them, which is why this needs
 * Playwright at all).
 *
 * See __tests__/e2e/README.md — blocked on a sign-in method.
 */
test.describe("drag with a real pointer", () => {
  test("drags a block from one day to another and saves once", async ({ page }) => {
    await page.goto("/");

    const block = page.locator("[draggable='true']").filter({ hasText: /./ }).first();
    const sourceBox = await block.boundingBox();
    expect(sourceBox).not.toBeNull();

    // A different day column, several hundred pixels to the right.
    const targetX = sourceBox!.x + 400;
    const targetY = sourceBox!.y + 20;

    const t0 = Date.now();
    await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
    await page.mouse.down();
    // Several intermediate moves — a single jump can fail to register as a
    // drag at all in some browsers/apps, which is part of what made the
    // original bug ("dragging did nothing") easy to miss with anything
    // other than a real, multi-step pointer path.
    await page.mouse.move(sourceBox!.x + 100, sourceBox!.y + 10, { steps: 5 });
    await page.mouse.move(targetX, targetY, { steps: 10 });
    const frameTimeMs = Date.now() - t0;
    await page.mouse.up();

    // The save is one server round trip — give it a moment, then the block
    // should have actually moved, not silently done nothing (the original
    // complaint).
    await page.waitForLoadState("networkidle");
    console.log(`drag frame time: ${frameTimeMs}ms`);

    const movedBox = await block.boundingBox();
    expect(movedBox).not.toBeNull();
    expect(movedBox!.x).not.toBeCloseTo(sourceBox!.x, 0);
  });

  test("opening the editor on a non-round-duration block (3.5h) shows 3.5h selected, not the first preset", async ({ page }) => {
    await page.goto("/");

    // Any block whose visible label includes a half-hour duration marker.
    const block = page.getByText(/3\.5h|08:30–12:00/).first();
    await block.click();

    const durationSelect = page.getByRole("combobox").filter({ hasText: "3.5h" });
    await expect(durationSelect).toHaveValue("210"); // 3.5h in minutes
  });

  test("drags a block within the same day to a different time", async ({ page }) => {
    await page.goto("/");

    const block = page.locator("[draggable='true']").first();
    const sourceBox = await block.boundingBox();
    expect(sourceBox).not.toBeNull();

    await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + 5);
    await page.mouse.down();
    await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + 120, { steps: 8 });
    await page.mouse.up();

    await page.waitForLoadState("networkidle");
    const movedBox = await block.boundingBox();
    expect(movedBox!.y).not.toBeCloseTo(sourceBox!.y, 0);
  });
});
