import { mapEdgeFnError } from "./edgeFnErrors";
import { tryMapNetworkError } from "./networkErrors";
import { tryMapPostgresError } from "./postgresErrors";
import { tryMapStorageError } from "./storageErrors";
import { tryMapStripeError } from "./stripeErrors";
import { tryMapAuthError } from "./supabaseAuthErrors";
import type { EdgeFnErrorInput, UserFacingError } from "./types";

// Belt-and-suspenders regex safety net: if a candidate "friendly" message
// still smells like a raw database / RLS / edge-fn error, replace it with
// a generic fallback. Catches future regressions where a new code path
// passes an unmapped raw `error.message` through to the user.
//
// MUST be conservative — overly aggressive matching would suppress
// legitimate error text (e.g. anything mentioning "policy" or "constraint"
// for legal/policy pages). Patterns below are anchored to vocabulary that
// appears in raw Postgres / PostgREST / Supabase errors and is unlikely
// to appear in well-written friendly copy.
const RAW_TECHNICAL_PATTERNS: RegExp[] = [
  /violates\s+(unique|check|not[- ]null|foreign\s*key|exclusion)\s+constraint/i,
  /duplicate\s+key\s+value\s+violates/i,
  /relation\s+"[^"]+"\s+does\s+not\s+exist/i,
  /column\s+"[^"]+"\s+(of\s+relation\s+"[^"]+"|does\s+not\s+exist)/i,
  /\bPGRST\d+\b/,
  /SQLSTATE[\s=]/i,
  /JWT(\s+expired|\s+malformed|\s+signature)/i,
  /row\s+level\s+security|RLS\s+policy/i,
  /pg_advisory_(xact_)?lock/i,
  /\bsupabase\b.*\b(error|exception)/i,
  // Bare error names common in raw frames.
  /^(TypeError|RangeError|SyntaxError):/,
];

function looksLikeRawTechnicalError(message: string): boolean {
  return RAW_TECHNICAL_PATTERNS.some((pattern) => pattern.test(message));
}

function sanitize(
  candidate: UserFacingError,
  fallback: string,
): UserFacingError {
  if (looksLikeRawTechnicalError(candidate.message)) {
    return {
      ...candidate,
      message: fallback,
    };
  }
  return candidate;
}

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
  if (network) return sanitize(network, fallbackMessage);

  // 2. Stripe (has distinctive `type` / `decline_code` shape)
  const stripe = tryMapStripeError(error);
  if (stripe) return sanitize(stripe, fallbackMessage);

  // 3. Supabase Auth
  const auth = tryMapAuthError(error);
  if (auth) return sanitize(auth, fallbackMessage);

  // 4. Supabase Storage
  const storage = tryMapStorageError(error);
  if (storage) return sanitize(storage, fallbackMessage);

  // 5. Postgres / PostgREST (also catches Supabase `.from()` / `.rpc()` errors)
  const pg = tryMapPostgresError(error);
  if (pg) return sanitize(pg, fallbackMessage);

  // 6. Native Error / unknown — generic fallback with technical data preserved
  if (error instanceof Error) {
    return sanitize(
      {
        code: "unknown",
        // If the raw Error.message smells technical, the sanitize layer
        // will replace it; otherwise we still don't surface raw text to
        // users — start with the fallback and let well-written sources
        // (auth/stripe mappers above) override it via their own paths.
        message: fallbackMessage,
        source: "unknown",
        retryable: true,
        technical: { name: error.name, message: error.message, stack: error.stack },
      },
      fallbackMessage,
    );
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
