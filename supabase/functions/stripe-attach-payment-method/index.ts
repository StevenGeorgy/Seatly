// stripe-attach-payment-method: Called by the booking checkout after a
// one-time PaymentIntent confirms AND the diner ticked "save this card."
// Retrieves the PI's PaymentMethod, attaches it to the diner's platform
// Stripe Customer (creating the customer if needed, same pattern as
// stripe-setup-intent), and inserts a `saved_cards` row so the next
// booking shows the card in the saved-card picker.
//
// Idempotent: if the PM is already attached to the customer AND a
// saved_cards row already exists, returns the existing row.
//
// JWT-required (the diner must be authenticated to attach a card to
// their profile). Verify auth manually via JWT decode so we can read
// the auth_user_id without forcing verify_jwt = true config (mirrors
// stripe-setup-intent's pattern).
//
// Body: { payment_intent_id: string }
// Returns: { saved_card: { id, brand, last4, exp_month, exp_year, is_default } }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { enforceRateLimit, rateLimitIdentifier, RateLimitError } from "../_shared/rate-limit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Payload = {
  payment_intent_id?: unknown;
};

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1];
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const decoded = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(decoded);
  } catch {
    return null;
  }
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
    try {
      await enforceRateLimit(
        supabaseAdmin,
        "stripe-attach-payment-method",
        rateLimitIdentifier(req),
        { limit: 30, windowSeconds: 60 },
      );
    } catch (err) {
      if (err instanceof RateLimitError) return jsonRes({ error: err.message }, 429);
      throw err;
    }

    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
    if (!token) return jsonRes({ error: "Authentication required" }, 401);

    const jwtPayload = decodeJwtPayload(token);
    const authUserId = jwtPayload?.sub as string | undefined;
    if (!authUserId) return jsonRes({ error: "Unauthorized" }, 401);

    const payload = (await req.json().catch(() => ({}))) as Payload;
    const paymentIntentId =
      typeof payload.payment_intent_id === "string" && payload.payment_intent_id.trim()
        ? payload.payment_intent_id.trim()
        : null;
    if (!paymentIntentId) return jsonRes({ error: "payment_intent_id is required" }, 400);
    if (!paymentIntentId.startsWith("pi_")) {
      return jsonRes({ error: "Invalid payment_intent_id format" }, 400);
    }

    const { data: profileRaw, error: profileErr } = await supabaseAdmin
      .from("user_profiles")
      .select("id, full_name, email, stripe_customer_id")
      .eq("auth_user_id", authUserId)
      .maybeSingle();
    if (profileErr) return jsonRes({ error: profileErr.message }, 400);
    if (!profileRaw) return jsonRes({ error: "User profile not found" }, 404);
    const profile = profileRaw as {
      id: string;
      full_name: string | null;
      email: string | null;
      stripe_customer_id: string | null;
    };

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) return jsonRes({ error: "Stripe is not configured on the server" }, 500);

    const { default: Stripe } = await import("npm:stripe@17");
    const stripe = new Stripe(stripeKey, { apiVersion: "2024-11-20.acacia" });

    // Re-fetch the PI to get the payment_method id Stripe-side. The PI
    // was created with no customer attached (one-time card), so the PM
    // is detached after charge. We need to attach it to the diner's
    // platform Customer to make it reusable.
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (intent.status !== "succeeded" && intent.status !== "processing") {
      return jsonRes(
        { error: `PaymentIntent not paid (status: ${intent.status})` },
        400,
      );
    }
    const pmId = typeof intent.payment_method === "string"
      ? intent.payment_method
      : intent.payment_method?.id ?? null;
    if (!pmId) return jsonRes({ error: "PaymentIntent has no payment method" }, 400);

    // Ensure the diner has a Stripe Customer. Same pattern as
    // stripe-setup-intent. Lazy-create so we don't burn a Customer row
    // on every diner who never saves a card.
    let customerId = profile.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: profile.email || undefined,
        name: profile.full_name || undefined,
        metadata: { user_profile_id: profile.id },
      });
      customerId = customer.id;
      await supabaseAdmin
        .from("user_profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", profile.id);
    }

    // Attach the PM to the customer. Idempotent — if the PM is already
    // attached to THIS customer, this is a no-op. If attached to a
    // different customer, Stripe will reject (which is fine — the diner
    // can't steal someone else's PM).
    try {
      await stripe.paymentMethods.attach(pmId, { customer: customerId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const code = (err as { code?: string }).code;
      // "payment_method_already_attached" + customer matches → treat as success.
      if (code !== "payment_method_already_attached") {
        return jsonRes({ error: msg }, 400);
      }
    }

    // Retrieve the PM details for our saved_cards row.
    const pm = await stripe.paymentMethods.retrieve(pmId);
    const card = pm.card;
    if (!card) return jsonRes({ error: "PaymentMethod is not a card" }, 400);

    // Insert or update the saved_cards row. Existing row (same pm_id) is
    // an idempotency hit — return it unchanged.
    const { data: existingCard } = await supabaseAdmin
      .from("saved_cards")
      .select("id, brand, last4, exp_month, exp_year, is_default")
      .eq("user_profile_id", profile.id)
      .eq("stripe_payment_method_id", pmId)
      .maybeSingle();

    if (existingCard) {
      return jsonRes({ saved_card: existingCard, idempotent: true });
    }

    // Is this the first card? Default it if so.
    const { count: existingCount } = await supabaseAdmin
      .from("saved_cards")
      .select("id", { count: "exact", head: true })
      .eq("user_profile_id", profile.id);
    const isDefault = (existingCount ?? 0) === 0;

    const { data: newCard, error: insertErr } = await supabaseAdmin
      .from("saved_cards")
      .insert({
        user_profile_id: profile.id,
        stripe_payment_method_id: pmId,
        brand: card.brand,
        last4: card.last4,
        exp_month: card.exp_month,
        exp_year: card.exp_year,
        is_default: isDefault,
      })
      .select("id, brand, last4, exp_month, exp_year, is_default")
      .single();
    if (insertErr) return jsonRes({ error: insertErr.message }, 400);

    return jsonRes({ saved_card: newCard });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonRes({ error: msg }, 500);
  }
});
