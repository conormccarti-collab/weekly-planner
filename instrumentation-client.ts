import * as Sentry from "@sentry/nextjs";

/** v5 Stage 12a.5 — the client-side half of instrumentation.ts. Same no-op-without-a-DSN behaviour. */
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0.1,
  });
}
