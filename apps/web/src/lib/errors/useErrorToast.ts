import { useCallback } from "react";
import { toast } from "sonner";

import { captureError } from "@/lib/analytics/sentry";
import { toUserFacingError } from "./friendlyError";
import type { UserFacingError } from "./types";

type ErrorToastOptions = {
  /** Override the default fallback message for unknown errors. */
  fallback?: string;
  /** Prefix the message with context (e.g. "Couldn't save menu — ..."). */
  context?: string;
  /** Sonner duration in ms. Defaults to 5000. */
  duration?: number;
  /** Tag used in the console log line, e.g. "[useFloorPlan.save]". */
  logTag?: string;
};

/**
 * Single entry point for showing errors to users. Always:
 *   1. Maps the raw error to friendly plain-language text.
 *   2. Shows a sonner toast with that text.
 *   3. Logs the technical detail to console.error for the developer.
 *
 * Returns the resolved `UserFacingError` so callers can branch on `.code`
 * (e.g. "diner_double_book" → open a different modal instead).
 */
export function useErrorToast() {
  const errorToast = useCallback(
    (error: unknown, options?: ErrorToastOptions): UserFacingError => {
      const friendly = toUserFacingError(error, options?.fallback);
      const displayed = options?.context
        ? `${options.context} — ${friendly.message}`
        : friendly.message;

      toast.error(displayed, { duration: options?.duration ?? 5000 });

      if (typeof console !== "undefined") {
        const tag = options?.logTag ?? "[error]";
        console.error(tag, friendly.code, friendly.technical ?? error);
      }

      // Auto-capture to Sentry so every user-visible error becomes an
      // operational breadcrumb. The friendly text already went to the
      // user; the raw error goes to ops. Safe no-op when Sentry isn't
      // configured (initSentry early-returns).
      try {
        captureError(friendly.technical ?? error);
      } catch {
        // Don't let Sentry hiccups bubble.
      }

      return friendly;
    },
    [],
  );

  return { errorToast };
}

/**
 * Non-hook variant for use outside React (e.g. inside event handlers in
 * non-component utilities). Same behavior as `errorToast`.
 */
export function showErrorToast(
  error: unknown,
  options?: ErrorToastOptions,
): UserFacingError {
  const friendly = toUserFacingError(error, options?.fallback);
  const displayed = options?.context
    ? `${options.context} — ${friendly.message}`
    : friendly.message;

  toast.error(displayed, { duration: options?.duration ?? 5000 });

  if (typeof console !== "undefined") {
    const tag = options?.logTag ?? "[error]";
    console.error(tag, friendly.code, friendly.technical ?? error);
  }

  // Same Sentry auto-capture as the hook variant.
  try {
    captureError(friendly.technical ?? error);
  } catch {
    // ignore
  }

  return friendly;
}
