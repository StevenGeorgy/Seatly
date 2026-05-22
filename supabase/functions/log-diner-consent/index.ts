// log-diner-consent: writes Terms / Privacy acceptance rows to
// diner_consent_log immediately after diner signup. Called from
// RegisterPage after the auth session is established.
//
// Auth: caller must be the diner who just signed up. We verify the JWT
// ourselves; `verify_jwt = false` in config.toml because the gateway
// rejects ES256-signed tokens before our code runs.
//
// Payload: {
//   consents: Array<{
//     consent_type: 'terms_of_service' | 'privacy_policy',
//     agreement_version: string,
//     disclosure_text: string,
//   }>,
//   source: string  // 'register_email' | 'register_google' | ...
// }
//
// Writes one row per consent. Errors are surfaced so the client can retry,
// but signup itself should NOT be blocked on log failure — the client
// fires this fire-and-forget after a successful sign-up.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "zod";

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

function firstHopIp(req: Request): string | null {
  const xff = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for");
  if (!xff) return null;
  const first = xff.split(",")[0]?.trim();
  return first || null;
}

const ConsentItemSchema = z.object({
  consent_type: z.enum(["terms_of_service", "privacy_policy"]),
  agreement_version: z.string().min(1).max(40),
  disclosure_text: z.string().min(1).max(5000),
});

const BodySchema = z.object({
  consents: z.array(ConsentItemSchema).min(1).max(4),
  source: z.string().min(1).max(60),
});

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonRes({ error: "POST only" }, 405);

  try {
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) return jsonRes({ error: "Missing authorization token" }, 401);

    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) return jsonRes({ error: "Invalid or expired session" }, 401);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonRes({ error: "Invalid JSON body" }, 400);
    }
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return jsonRes({ error: "Invalid payload", issues: parsed.error.issues }, 400);
    }

    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("user_profiles")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (profileErr || !profile) {
      return jsonRes({ error: "User profile not found" }, 404);
    }
    const userProfileId = (profile as { id: string }).id;

    const ipAddress = firstHopIp(req);
    const userAgent = req.headers.get("user-agent");

    const rows = parsed.data.consents.map((c) => ({
      user_profile_id: userProfileId,
      consent_type: c.consent_type,
      agreement_version: c.agreement_version,
      disclosure_text: c.disclosure_text,
      source: parsed.data.source,
      ip_address: ipAddress,
      user_agent: userAgent,
    }));

    const { error: insertErr } = await supabaseAdmin
      .from("diner_consent_log")
      .insert(rows);

    if (insertErr) {
      console.error("[log-diner-consent] insert failed", insertErr);
      return jsonRes({ error: insertErr.message }, 500);
    }

    return jsonRes({ ok: true, rows_written: rows.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[log-diner-consent] threw", msg);
    return jsonRes({ error: msg }, 500);
  }
});
