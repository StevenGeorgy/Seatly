// @ts-nocheck
// CORS handling. The mobile React Native app does not send `Origin` headers,
// so it is unaffected by the allowlist. Browser callers (the web app, any
// admin tools) must come from an allowed origin.
//
// Set ALLOWED_ORIGINS as a comma-separated env (e.g. "https://app.cenaiva.com,https://staging.cenaiva.com").
// If unset, falls back to the previous wildcard behavior so a fresh
// deploy doesn't break before the env is wired up.

const ALLOWED_ORIGINS_RAW = (Deno.env.get("ALLOWED_ORIGINS") ?? "").trim();
const ALLOWED_ORIGINS = ALLOWED_ORIGINS_RAW
  ? ALLOWED_ORIGINS_RAW.split(",").map((s) => s.trim()).filter(Boolean)
  : [];

const SHARED_HEADERS = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Vary": "Origin",
};

function pickOrigin(requestOrigin: string | null): string {
  if (ALLOWED_ORIGINS.length === 0) return "*"; // fallback while env is unset
  if (requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin)) return requestOrigin;
  // No match — echo the first allowed origin so preflight still completes.
  // The actual request will be CORS-blocked by the browser when origins
  // don't agree, which is the desired behavior.
  return ALLOWED_ORIGINS[0];
}

/**
 * Build CORS headers for a specific request. Prefer this over the legacy
 * `corsHeaders` constant — it lets the response echo the matching origin
 * instead of always sending `*`.
 */
export function buildCorsHeaders(req?: Request): Record<string, string> {
  const origin = req?.headers?.get?.("Origin") ?? null;
  return {
    "Access-Control-Allow-Origin": pickOrigin(origin),
    ...SHARED_HEADERS,
  };
}

// Legacy export kept for handlers that still reference it directly. New code
// should call buildCorsHeaders(req) so the response echoes the actual origin.
export const corsHeaders = {
  "Access-Control-Allow-Origin": pickOrigin(null),
  ...SHARED_HEADERS,
};
