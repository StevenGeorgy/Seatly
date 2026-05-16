/**
 * Shared shapes for friendly-error mapping. See `friendlyError.ts` for the
 * routing entry point and per-source mappers for code lists.
 */

export type ErrorSource =
  | "pg"
  | "auth"
  | "edge-fn"
  | "stripe"
  | "storage"
  | "network"
  | "voice"
  | "unknown";

/**
 * Stable, human-readable error envelope shown to users.
 *
 * - `code` is stable across releases — safe to use for analytics, branching, or
 *   future i18n keys.
 * - `message` is plain language, ready to drop into a toast or alert.
 * - `technical` is the original error data, for `console.error` only — never
 *   show to a user.
 */
export type UserFacingError = {
  code: string;
  message: string;
  source: ErrorSource;
  retryable: boolean;
  technical?: unknown;
};

/**
 * Standard error response shape returned by Cenaiva edge functions. Most
 * functions return either `{ error: "..." }` or `{ ok: false, error: "..." }`,
 * sometimes with an extra `unavailable_reason` / `reason` field that carries
 * a stable code (e.g. `"diner_double_book"`).
 */
export type EdgeFnErrorBody = {
  ok?: boolean;
  error?: string;
  message?: string;
  reason?: string;
  unavailable_reason?: string;
  retry_after?: number;
  code?: string;
};

export type EdgeFnErrorInput = {
  status: number;
  body?: EdgeFnErrorBody | null;
};
