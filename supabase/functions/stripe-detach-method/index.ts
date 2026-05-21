// stripe-detach-method: bug-fix edge fn (2026-05-20). The diner UI in
// PaymentMethodsSection.tsx has been calling this endpoint when a diner
// deletes a saved card — but the fn didn't exist, so the Stripe-side
// PaymentMethod silently stayed attached to the diner's customer.
//
// This fn detaches the PaymentMethod on the diner's user_profiles
// stripe_customer_id. Owner-side card removal goes through
// update-subscription-payment-method (which detaches "other" cards as a
// side-effect of changing the default).
//
// Auth: caller must own the PaymentMethod (i.e. pm.customer must equal
// their user_profiles.stripe_customer_id). JWT decoded here.
// `verify_jwt = false` in supabase/config.toml.
//
// Payload: { payment_method_id }
//
// Returns: { ok: true } | { error, ... }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { enforceRateLimit, rateLimitIdentifier, RateLimitError } from "../_shared/rate-limit.ts";
import { parseJsonBody } from "../_shared/validation/parse.ts";
import { StripeDetachMethodSchema } from "../_shared/validation/payment.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Payload = { payment_method_id?: unknown };

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonRes({ error: "POST only" }, 405);

  try {
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) return jsonRes({ error: "Missing authorization token" }, 401);

    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) return jsonRes({ error: "Invalid or expired session" }, 401);

    const parsed = await parseJsonBody(req, StripeDetachMethodSchema, {
      jsonRes: (b, s) => jsonRes(b, s),
    });
    if ("response" in parsed) return parsed.response;
    const paymentMethodId = parsed.data.payment_method_id;

    try {
      await enforceRateLimit(
        supabaseAdmin,
        "stripe-detach-method",
        rateLimitIdentifier(req, user.id),
        { limit: 30, windowSeconds: 60 },
      );
    } catch (err) {
      if (err instanceof RateLimitError) return jsonRes({ error: err.message }, 429);
      throw err;
    }

    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("user_profiles")
      .select("id, stripe_customer_id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (profileErr || !profile) return jsonRes({ error: "User profile not found" }, 404);

    const customerId = (profile as { stripe_customer_id: string | null }).stripe_customer_id;
    if (!customerId) {
      // No Stripe customer on this profile — there's nothing to detach on
      // Stripe's side. Treat as success (idempotent).
      return jsonRes({ ok: true, already_detached: true });
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) return jsonRes({ error: "Stripe is not configured on the server" }, 500);

    const { default: Stripe } = await import("npm:stripe@17");
    const stripe = new Stripe(stripeKey, { apiVersion: "2024-11-20.acacia" });

    // Confirm the PM belongs to this diner. Cross-user detach attempts
    // get 403'd — that's a security boundary.
    try {
      const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
      if (pm.customer && pm.customer !== customerId) {
        return jsonRes({
          error: "That card belongs to a different account.",
          stripe_code: "payment_method_customer_mismatch",
        }, 403);
      }
      if (!pm.customer) {
        // Already detached.
        return jsonRes({ ok: true, already_detached: true });
      }
    } catch (err) {
      const e = err as { message?: string; code?: string; type?: string };
      // Stripe's "resource_missing" / "No such payment_method" is benign —
      // already gone. Anything else, surface it.
      if (e.code === "resource_missing") {
        return jsonRes({ ok: true, already_detached: true });
      }
      return jsonRes({
        error: e.message ?? String(err),
        stripe_code: e.code,
        stripe_type: e.type,
      }, 400);
    }

    try {
      await stripe.paymentMethods.detach(paymentMethodId);
    } catch (err) {
      const e = err as { message?: string; code?: string };
      const msg = (e.message ?? "").toLowerCase();
      // Idempotent: already-detached / not-attached errors are success.
      if (
        e.code === "resource_missing" ||
        msg.includes("already") ||
        msg.includes("not attached") ||
        msg.includes("no such")
      ) {
        return jsonRes({ ok: true, already_detached: true });
      }
      return jsonRes({ error: e.message ?? String(err), stripe_code: e.code }, 400);
    }

    return jsonRes({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonRes({ error: msg }, 500);
  }
});
