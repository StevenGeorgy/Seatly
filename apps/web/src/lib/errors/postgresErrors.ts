import type { UserFacingError } from "./types";

/**
 * Postgres error codes the Cenaiva backend actually raises. RPCs raise the
 * P0xxx range via `RAISE EXCEPTION ... USING ERRCODE = '...'`. Constraint
 * codes (23xxx) and RLS denials (42501) come from Postgres directly.
 */
type PgErrorCode =
  | "P0001"
  | "P0002"
  | "P0006"
  | "P0010"
  | "P0011"
  | "P0012"
  | "23505"
  | "23503"
  | "23P01"
  | "42501"
  | "PGRST116"
  | "PGRST301";

type PgEntry = {
  message: string;
  code: string;
  retryable: boolean;
};

const PG_MAP: Record<PgErrorCode, PgEntry> = {
  P0001: {
    code: "no_table_available",
    message: "No table is open at that time. Try another time or party size.",
    retryable: true,
  },
  P0002: {
    code: "over_cover_cap",
    message:
      "That time is at capacity. Try a slightly earlier or later slot.",
    retryable: true,
  },
  P0006: {
    code: "diner_double_book",
    message:
      "You already have a reservation around that time. Cancel that one first or pick a different time.",
    retryable: false,
  },
  P0010: {
    code: "hold_not_found",
    message: "We couldn't find your table hold. Pick a time and try again.",
    retryable: false,
  },
  P0011: {
    code: "hold_expired",
    message: "Your table hold ended. Grab the slot again to keep going.",
    retryable: true,
  },
  P0012: {
    code: "hold_not_convertible",
    message: "Something went wrong finishing your booking. Try again.",
    retryable: true,
  },
  "23505": {
    code: "duplicate",
    message: "That already exists. Try a different value.",
    retryable: false,
  },
  "23503": {
    code: "missing_reference",
    message: "Something this depends on is missing. Refresh and try again.",
    retryable: true,
  },
  "23P01": {
    code: "diner_double_book",
    message:
      "You already have a reservation around that time. Cancel that one first or pick a different time.",
    retryable: false,
  },
  "42501": {
    code: "not_allowed",
    message: "You don't have permission to do that. Sign in or contact support.",
    retryable: false,
  },
  PGRST116: {
    code: "not_found",
    message: "We couldn't find what you're looking for.",
    retryable: false,
  },
  PGRST301: {
    code: "session_expired",
    message: "Your session ended. Sign in again to continue.",
    retryable: false,
  },
};

const GENERIC: UserFacingError = {
  code: "db_error",
  message: "Something went wrong saving that. Try again in a moment.",
  source: "pg",
  retryable: true,
};

/**
 * Try to interpret an error as a Postgres / PostgREST / Supabase SDK error.
 * Returns `null` if the error doesn't look like one (caller falls through to
 * the next mapper).
 */
export function tryMapPostgresError(error: unknown): UserFacingError | null {
  if (!error || typeof error !== "object") return null;

  const e = error as { code?: string; message?: string; details?: string; hint?: string };
  const code = (e.code ?? "").toString();
  if (!code) return null;

  const entry = PG_MAP[code as PgErrorCode];
  if (entry) {
    return {
      code: entry.code,
      message: entry.message,
      source: "pg",
      retryable: entry.retryable,
      technical: e,
    };
  }

  // Code looks Postgres-shaped (5 chars, often digits + letters) but unknown.
  if (/^(P|2[2-9]|42|PGRST)/i.test(code)) {
    return { ...GENERIC, technical: e };
  }

  return null;
}
