// loyalty-waitlist-signup: anon-callable signup endpoint for the /loyalty
// Coming Soon page. Stores the visitor's email in `loyalty_waitlist` so the
// team can announce when the loyalty programme launches.
//
// Auth: optional. If a bearer token is present, we resolve the auth user and
// link the row to their user_profiles.id. Anon submissions are allowed.
// `verify_jwt = false` in supabase/config.toml — we decode the JWT ourselves
// (when present) and gate writes via service-role.
//
// Payload: { email, source? }
//   email — required; basic format-checked
//   source — optional; from a `?ref=` query string on the page (e.g. campaign tag)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { enforceRateLimit, rateLimitIdentifier, RateLimitError } from "../_shared/rate-limit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Payload = {
  email?: unknown;
  source?: unknown;
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SOURCE_RE = /^[A-Za-z0-9_-]{1,64}$/;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonRes({ error: "POST only" }, 405);

  try {
    const payload = (await req.json().catch(() => ({}))) as Payload;

    const rawEmail =
      typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
    if (!rawEmail || rawEmail.length > 254 || !EMAIL_RE.test(rawEmail)) {
      return jsonRes({ error: "Please enter a valid email address." }, 400);
    }

    let source: string | null = null;
    if (typeof payload.source === "string") {
      const trimmed = payload.source.trim();
      if (trimmed && SOURCE_RE.test(trimmed)) source = trimmed;
    }

    // Optional auth: if a token is present, link the row to the user_profile.
    // Failure to resolve is non-fatal — anon signup is allowed.
    let userId: string | null = null;
    let authUserId: string | null = null;
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (token) {
      const { data: { user } } = await supabaseAdmin.auth.getUser(token);
      if (user) {
        authUserId = user.id;
        const { data: profile } = await supabaseAdmin
          .from("user_profiles")
          .select("id")
          .eq("auth_user_id", user.id)
          .maybeSingle();
        if (profile) userId = (profile as { id: string }).id;
      }
    }

    // Rate-limit by user id when known, else by IP. 5 submissions per minute is
    // generous for a real user; abuse hits the limit fast.
    try {
      await enforceRateLimit(
        supabaseAdmin,
        "loyalty-waitlist-signup",
        rateLimitIdentifier(req, authUserId),
        { limit: 5, windowSeconds: 60 },
      );
    } catch (err) {
      if (err instanceof RateLimitError) return jsonRes({ error: err.message }, 429);
      throw err;
    }

    const { error: insertErr } = await supabaseAdmin
      .from("loyalty_waitlist")
      .insert({ email: rawEmail, user_id: userId, source });

    if (insertErr) {
      // 23505 = unique_violation — caller is already on the list. From the
      // user's POV that's success; surfacing the conflict would feel like an
      // error when it isn't one.
      if ((insertErr as { code?: string }).code === "23505") {
        return jsonRes({ ok: true, already_signed_up: true });
      }
      return jsonRes({ error: insertErr.message }, 500);
    }

    return jsonRes({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonRes({ error: msg }, 500);
  }
});
