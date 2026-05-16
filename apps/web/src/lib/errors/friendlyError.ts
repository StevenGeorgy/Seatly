import { mapEdgeFnError } from "./edgeFnErrors";
import { tryMapNetworkError } from "./networkErrors";
import { tryMapPostgresError } from "./postgresErrors";
import { tryMapStorageError } from "./storageErrors";
import { tryMapStripeError } from "./stripeErrors";
import { tryMapAuthError } from "./supabaseAuthErrors";
import type { EdgeFnErrorInput, UserFacingError } from "./types";

/**
 * Convert any caught error into a `UserFacingError` with friendly text. Order
 * matters — most specific mappers first.
 *
 * Usage:
 *   try { ... }
 *   catch (err) {
 *     const friendly = toUserFacingError(err);
 *     toast.error(friendly.message);
 *     console.error("[xyz]", friendly.technical);
 *   }
 *
 * For edge-function HTTP responses (where `err` is a `{ status, body }`
 * envelope rather than a thrown Error), use `mapEdgeFnError` directly:
 *   const body = await res.json().catch(() => null);
 *   if (!res.ok) {
 *     const friendly = mapEdgeFnError({ status: res.status, body });
 *     ...
 *   }
 */
export function toUserFacingError(
  error: unknown,
  fallbackMessage = "Something went wrong. Try again in a moment.",
): UserFacingError {
  if (error == null) {
    return {
      code: "unknown",
      message: fallbackMessage,
      source: "unknown",
      retryable: true,
    };
  }

  // 1. Network errors (TypeError "Failed to fetch", AbortError, offline)
  const network = tryMapNetworkError(error);
  if (network) return network;

  // 2. Stripe (has distinctive `type` / `decline_code` shape)
  const stripe = tryMapStripeError(error);
  if (stripe) return stripe;

  // 3. Supabase Auth
  const auth = tryMapAuthError(error);
  if (auth) return auth;

  // 4. Supabase Storage
  const storage = tryMapStorageError(error);
  if (storage) return storage;

  // 5. Postgres / PostgREST (also catches Supabase `.from()` / `.rpc()` errors)
  const pg = tryMapPostgresError(error);
  if (pg) return pg;

  // 6. Native Error / unknown — generic fallback with technical data preserved
  if (error instanceof Error) {
    return {
      code: "unknown",
      message: fallbackMessage,
      source: "unknown",
      retryable: true,
      technical: { name: error.name, message: error.message, stack: error.stack },
    };
  }

  return {
    code: "unknown",
    message: fallbackMessage,
    source: "unknown",
    retryable: true,
    technical: error,
  };
}

/**
 * Helper for `fetch`-based edge function calls. Parse the JSON body, then
 * call this with the Response + body.
 */
export function toUserFacingEdgeError(
  res: Response,
  body: EdgeFnErrorInput["body"],
): UserFacingError {
  return mapEdgeFnError({ status: res.status, body });
}

/**
 * Re-export for callers that just want a one-line message string.
 */
export function getFriendlyMessage(error: unknown, fallback?: string): string {
  return toUserFacingError(error, fallback).message;
}
