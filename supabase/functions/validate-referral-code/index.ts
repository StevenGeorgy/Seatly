// validate-referral-code: anon-callable lookup used by the onboarding wizard
// as the owner types a referral code. Returns `{ valid: true, ... }` only when
// the normalized code matches a live (non-deleted) restaurant's referral_code.
//
// Auth: none (verify_jwt = false). Rate-limited per-IP (20/min) to prevent
// enumeration of referral codes.
//
// Payload: { code: string } — typically 7 chars, accepted 4–20 alphanumeric.
//
// Returns:
//   { valid: true, referrer_name, referrer_restaurant_id } on match
//   { valid: false } on invalid format OR not-found (same shape — don't leak
//   which codes "look real but don't exist")
//   { error: string } on infrastructure failure (5xx) or rate limit (429)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { enforceRateLimit, rateLimitIdentifier, RateLimitError } from "../_shared/rate-limit.ts";
import { parseJsonBody } from "../_shared/validation/parse.ts";
import { ValidateReferralCodeSchema } from "../_shared/validation/public.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const CODE_RE = /^[A-Z0-9]{4,20}$/;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonRes({ error: "POST only" }, 405);

  try {
    try {
      await enforceRateLimit(
        supabaseAdmin,
        "validate-referral-code",
        rateLimitIdentifier(req, null),
        { limit: 20, windowSeconds: 60 },
      );
    } catch (err) {
      if (err instanceof RateLimitError) return jsonRes({ error: err.message }, 429);
      throw err;
    }

    const parsed = await parseJsonBody(req, ValidateReferralCodeSchema, {
      jsonRes: (b, s) => jsonRes(b, s),
    });
    if ("response" in parsed) return parsed.response;
    const rawCode = (parsed.data.code ?? "").trim();
    if (!rawCode) return jsonRes({ valid: false });

    const normalized = rawCode.toUpperCase();
    if (!CODE_RE.test(normalized)) return jsonRes({ valid: false });

    const { data, error } = await supabaseAdmin
      .from("restaurants")
      .select("id, name")
      .eq("referral_code", normalized)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();

    if (error) {
      // Don't echo Postgres errors to anon callers. Log + opaque failure.
      console.warn("[validate-referral-code] db error", error.message);
      return jsonRes({ error: "Lookup failed" }, 500);
    }

    if (!data) return jsonRes({ valid: false });

    const row = data as { id: string; name: string | null };
    return jsonRes({
      valid: true,
      referrer_name: row.name ?? "Another Cenaiva restaurant",
      referrer_restaurant_id: row.id,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonRes({ error: msg }, 500);
  }
});
