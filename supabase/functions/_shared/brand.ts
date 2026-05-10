// @ts-nocheck
// Server-side brand identity. Mirrors lib/config/legalLinks.ts on the
// client. Edge functions should reference BRAND_DOMAIN here (and the
// derived USER_AGENT) rather than baking "cenaiva.com" / "Seatly" into
// outbound calls.

const DEFAULT_BRAND_DOMAIN = "cenaiva.com";
const DEFAULT_BRAND_NAME = "Cenaiva";

export const BRAND_DOMAIN =
  (Deno.env.get("BRAND_DOMAIN") ?? "").trim() || DEFAULT_BRAND_DOMAIN;

export const BRAND_NAME =
  (Deno.env.get("BRAND_NAME") ?? "").trim() || DEFAULT_BRAND_NAME;

// User-Agent used for outbound calls to third-party APIs (Nominatim, etc.).
// Some providers require a contact URL — keep this informative rather than
// generic so they can throttle a specific app rather than a whole bucket.
export const USER_AGENT = `${BRAND_NAME}/1.0 (${BRAND_DOMAIN})`;
