import { defineConfig, devices } from "@playwright/test";

/**
 * v5 Stage 12b: "End-to-end tests with a real pointer... real mouse events
 * (down, move, up), not synthetic drag events." These exercise the signed-in
 * app, so every test here needs a real session — see __tests__/e2e/README.md
 * for the auth precondition this is blocked on until you decide how to
 * provide one.
 */
export default defineConfig({
  testDir: "./__tests__/e2e",
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    storageState: "__tests__/e2e/.auth/storage-state.json",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
