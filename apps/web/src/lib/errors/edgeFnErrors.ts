import type { EdgeFnErrorInput, UserFacingError } from "./types";

/**
 * Edge functions return errors in a few different shapes (the recon flagged
 * this inconsistency). All routes converge here.
 *
 * Typical shapes:
 *   { error: "diner_double_book" }                    // booking
 *   { error: "user message", unavailable_reason: "no_table" }  // hold
 *   { ok: false, error: "...", requires_action: true }  // stripe-charge-order
 *   { error: "hold_expired" }                          // confirm-hold-paid
 *
 * We branch on the stable code (when present) then HTTP status, finally the
 * raw error string.
 */

type ReasonEntry = {
  code: string;
  message: string;
  retryable: boolean;
};

const REASON_MAP: Record<string, ReasonEntry> = {
  // Booking / hold
  no_table: {
    code: "no_table",
    message: "No table is open at that time. Try another time or party size.",
    retryable: true,
  },
  no_tables: {
    code: "no_table",
    message: "No table is open at that time. Try another time or party size.",
    retryable: true,
  },
  over_cover_cap: {
    code: "over_cover_cap",
    message: "That time is at capacity. Try a slightly earlier or later slot.",
    retryable: true,
  },
  diner_double_book: {
    code: "diner_double_book",
    message:
      "You already have a reservation around that time. Cancel that one first or pick a different time.",
    retryable: false,
  },
  hold_not_found: {
    code: "hold_not_found",
    message: "We couldn't find your table hold. Pick a time and try again.",
    retryable: false,
  },
  hold_expired: {
    code: "hold_expired",
    message: "Your table hold ended. Grab the slot again to keep going.",
    retryable: true,
  },
  hold_not_convertible: {
    code: "hold_not_convertible",
    message: "Something went wrong finishing your booking. Try again.",
    retryable: true,
  },
  slot_taken: {
    code: "slot_taken",
    message: "Someone just grabbed that time. Pick another slot.",
    retryable: true,
  },
  unavailable: {
    code: "slot_unavailable",
    message: "That slot isn't available anymore. Try another time.",
    retryable: true,
  },
  // Rate limit
  rate_limited: {
    code: "rate_limited",
    message: "You're going a little fast. Wait a minute and try again.",
    retryable: true,
  },
  // Payment / Stripe edge-fn
  payment_failed: {
    code: "payment_failed",
    message:
      "The payment didn't go through. Try again or use a different card.",
    retryable: true,
  },
  requires_action: {
    code: "stripe_3ds_required",
    message: "Your bank wants to verify this payment. Complete the prompt to finish.",
    retryable: true,
  },
  // Auth
  not_authenticated: {
    code: "not_authenticated",
    message: "Sign in to continue.",
    retryable: false,
  },
  unauthorized: {
    code: "not_authenticated",
    message: "Sign in to continue.",
    retryable: false,
  },
  forbidden: {
    code: "forbidden",
    message: "You don't have permission to do that.",
    retryable: false,
  },
  // Config / infra
  supabase_unconfigured: {
    code: "supabase_unconfigured",
    message: "This feature is unavailable right now. Try again later.",
    retryable: false,
  },
};

const STATUS_FALLBACKS: Record<number, ReasonEntry> = {
  401: {
    code: "not_authenticated",
    message: "Sign in to continue.",
    retryable: false,
  },
  403: {
    code: "forbidden",
    message: "You don't have permission to do that.",
    retryable: false,
  },
  404: {
    code: "not_found",
    message: "We couldn't find what you're looking for.",
    retryable: false,
  },
  409: {
    code: "conflict",
    message: "That conflicts with something already saved. Refresh and try again.",
    retryable: true,
  },
  410: {
    code: "gone",
    message: "That's no longer available. Pick a fresh option.",
    retryable: true,
  },
  429: {
    code: "rate_limited",
    message: "You're going a little fast. Wait a minute and try again.",
    retryable: true,
  },
  500: {
    code: "server_error",
    message: "Something went wrong on our end. Try again in a moment.",
    retryable: true,
  },
  502: {
    code: "bad_gateway",
    message: "We can't reach part of the service. Try again in a moment.",
    retryable: true,
  },
  503: {
    code: "unavailable",
    message: "Service is busy. Try again in a moment.",
    retryable: true,
  },
  504: {
    code: "timeout",
    message: "That took too long. Try again.",
    retryable: true,
  },
};

function pickReason(body: EdgeFnErrorInput["body"]): string | null {
  if (!body) return null;
  const candidates = [body.unavailable_reason, body.reason, body.code, body.error];
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) {
      const key = c.toLowerCase().trim();
      if (REASON_MAP[key]) return key;
    }
  }
  return null;
}

/**
 * Map an edge-function error response to a friendly message.
 * Pass the HTTP status and the parsed JSON body.
 */
export function mapEdgeFnError(input: EdgeFnErrorInput): UserFacingError {
  const reasonKey = pickReason(input.body);
  if (reasonKey) {
    const entry = REASON_MAP[reasonKey];
    return {
      code: entry.code,
      message: entry.message,
      source: "edge-fn",
      retryable: entry.retryable,
      technical: input,
    };
  }

  const statusEntry = STATUS_FALLBACKS[input.status];
  if (statusEntry) {
    return {
      code: statusEntry.code,
      message: statusEntry.message,
      source: "edge-fn",
      retryable: statusEntry.retryable,
      technical: input,
    };
  }

  return {
    code: "edge_fn_error",
    message: "Something went wrong. Try again in a moment.",
    source: "edge-fn",
    retryable: true,
    technical: input,
  };
}

/**
 * Convenience wrapper: takes a Response + already-parsed body and returns the
 * friendly error. For use in `fetch`-based edge-fn calls.
 */
export function fromResponse(
  res: Response,
  body: EdgeFnErrorInput["body"],
): UserFacingError {
  return mapEdgeFnError({ status: res.status, body });
}
