import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
    },
  },
  test: {
    // v5 Stage 12b: __tests__/e2e holds Playwright specs (run via
    // `npx playwright test`), not vitest ones — they use @playwright/test's
    // own test()/expect(), which vitest's runner can't execute.
    exclude: ["**/node_modules/**", "__tests__/e2e/**"],
  },
});
