import * as Sentry from "@sentry/react";

/**
 * Operational error tracking per ToS §19. Always-on (no consent required —
 * this is an operational reliability signal, not analytics). Sentry stays
 * disabled if `VITE_SENTRY_DSN` is unset so local + preview builds don't
 * spam the project.
 */
export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0, // Privacy: no session replay
    replaysOnErrorSampleRate: 0,
  });
}

export function captureError(err: unknown): void {
  Sentry.captureException(err);
}
