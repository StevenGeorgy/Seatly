// @ts-nocheck
import { buildCorsHeaders, corsHeaders } from "./cors.ts";

export function jsonRes(body: unknown, status = 200, req?: Request): Response {
  // When a Request is passed, use per-request CORS so the Allow-Origin
  // header echoes the actual origin (works for production AND local dev
  // localhost:5173). Falls back to the static `corsHeaders` constant when
  // no request is provided — those responses only satisfy browser CORS
  // for the first ALLOWED_ORIGINS entry. Migrate call sites that handle
  // browser-fetched endpoints to pass `req`.
  const cors = req ? buildCorsHeaders(req) : corsHeaders;
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
