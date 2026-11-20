import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/**
 * v5 Stage 12c / V5-01: "Loading the Week screen causes no database
 * writes, twice in a row." The write happens server-to-Supabase inside the
 * page's own request, invisible to Playwright's network tab, so this reads
 * `plan_items` directly with the service-role key instead of inspecting
 * requests. See __tests__/e2e/README.md — blocked on a sign-in method (and
 * this one additionally needs SUPABASE_SERVICE_ROLE_KEY /
 * NEXT_PUBLIC_SUPABASE_URL in the environment the suite runs in).
 */
test("loading the Week screen twice writes nothing to plan_items or weeks", async ({ page }) => {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  async function snapshot() {
    const { data: items } = await supabase.from("plan_items").select("id, day, status, updated_at").order("id");
    const { data: weeks } = await supabase.from("weeks").select("week_start, status, input_hash").order("week_start");
    return { items, weeks };
  }

  // SyncBar auto-syncs on every mount, and a sync completing is a real,
  // separate write trigger (12c) — correct behaviour, but not what this
  // test is checking. Blocking it isolates the page's own GET render path,
  // which is the thing that must be read-only.
  await page.route("**/api/sync/**", (route) => route.abort());

  const before = await snapshot();
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const afterFirst = await snapshot();
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const afterSecond = await snapshot();

  expect(afterFirst).toEqual(before);
  expect(afterSecond).toEqual(before);
});
