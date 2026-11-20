import * as Sentry from "@sentry/nextjs";

/**
 * v5 Stage 12a.5: "Add error logging that records server and client
 * errors... State which service you propose before adding one." Sentry,
 * approved. A no-op without SENTRY_DSN set (same "degrade gracefully
 * pending config" pattern as every migration-dependent feature this
 * project already has) — nothing breaks if it's never configured, it just
 * doesn't report anything.
 */
export async function register() {
  if (!process.env.SENTRY_DSN) return;

  if (process.env.NEXT_RUNTIME === "nodejs" || process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      tracesSampleRate: 0.1,
    });
  }
}

export const onRequestError = Sentry.captureRequestError;
