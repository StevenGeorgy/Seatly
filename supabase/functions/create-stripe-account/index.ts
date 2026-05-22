// create-stripe-account: Phase D (Stripe wire-up). Creates a Stripe Connect
// Custom account tied to a restaurant. Idempotent — if `restaurants.stripe_account_id`
// is already set, returns the existing account state without creating a new one.
//
// Auth: requires a valid Supabase user JWT. The function verifies the caller
// owns the restaurant via `user_restaurant_roles.role = 'owner'`.
// `verify_jwt = false` in supabase/config.toml because we decode the JWT
// ourselves (ES256 sessions on the gateway would 401 before our handler runs).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { enforceRateLimit, rateLimitIdentifier, RateLimitError } from "../_shared/rate-limit.ts";
import { parseJsonBody } from "../_shared/validation/parse.ts";
import { RestaurantIdOnlySchema } from "../_shared/validation/subscription.ts";
import { getStripeClient } from "../_shared/stripe-client.ts";
import { isOwnerOfRestaurant } from "../_shared/auth-restaurants.ts";

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


Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonRes({ error: "POST only" }, 405);

  try {
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) return jsonRes({ error: "Missing authorization token" }, 401);

    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) return jsonRes({ error: "Invalid or expired session" }, 401);

    const parsed = await parseJsonBody(req, RestaurantIdOnlySchema, { jsonRes });
    if ("response" in parsed) return parsed.response;
    const restaurantId = parsed.data.restaurant_id;

    try {
      await enforceRateLimit(
        supabaseAdmin,
        "create-stripe-account",
        rateLimitIdentifier(req, user.id),
        { limit: 20, windowSeconds: 60 },
      );
    } catch (err) {
      if (err instanceof RateLimitError) return jsonRes({ error: err.message }, 429);
      throw err;
    }

    const isOwner = await isOwnerOfRestaurant(supabaseAdmin, user.id, restaurantId);
    if (!isOwner) return jsonRes({ error: "Not authorized for this restaurant" }, 403);

    const { data: restaurant, error: restErr } = await supabaseAdmin
      .from("restaurants")
      .select("id, name, email, stripe_account_id")
      .eq("id", restaurantId)
      .maybeSingle();
    if (restErr || !restaurant) return jsonRes({ error: "Restaurant not found" }, 404);

    const row = restaurant as {
      id: string;
      name: string | null;
      email: string | null;
      stripe_account_id: string | null;
    };

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) return jsonRes({ error: "Stripe is not configured on the server" }, 500);

    const stripe = await getStripeClient(stripeKey);

    // Idempotent path: account already exists — refresh state from Stripe.
    if (row.stripe_account_id) {
      try {
        const account = await stripe.accounts.retrieve(row.stripe_account_id);
        return jsonRes({
          account_id: account.id,
          charges_enabled: Boolean(account.charges_enabled),
          payouts_enabled: Boolean(account.payouts_enabled),
          details_submitted: Boolean(account.details_submitted),
        });
      } catch (err) {
        // If Stripe says the account is gone (deauthorized externally),
        // clear the column so the next call recreates it.
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.toLowerCase().includes("no such account")) {
          await supabaseAdmin
            .from("restaurants")
            .update({
              stripe_account_id: null,
              stripe_charges_enabled: false,
              stripe_payouts_enabled: false,
              stripe_details_submitted: false,
            })
            .eq("id", row.id);
        } else {
          return jsonRes({ error: msg }, 500);
        }
      }
    }

    // Use type: "express" — Custom accounts require Stripe platform approval
    // most new platforms don't have. Express works out of the box and is fully
    // compatible with the ConnectAccountOnboarding embedded component (the
    // owner stays inside Cenaiva for KYC).
    //
    // Capabilities: ONLY `transfers`. Cenaiva's model is destination-charges:
    // diners pay Cenaiva's platform account, Stripe transfers the restaurant's
    // 94.5% share. The restaurant never directly charges a card. Requesting
    // `card_payments` here would create a capability mismatch with the
    // platform's Onboarding options (Payments isn't enabled for Canada at the
    // platform level) and causes the Embedded Connect iframe to fail with
    // "There was an error during authentication." If pay-the-table is ever
    // added later, enable Payments at platform level AND re-add card_payments
    // here in lock-step.
    const account = await stripe.accounts.create({
      type: "express",
      country: "CA",
      email: row.email ?? undefined,
      capabilities: {
        transfers: { requested: true },
      },
      business_profile: {
        name: row.name ?? undefined,
        mcc: "5812",
      },
      metadata: { restaurant_id: row.id, platform: "cenaiva" },
    });

    const { error: updateErr } = await supabaseAdmin
      .from("restaurants")
      .update({ stripe_account_id: account.id })
      .eq("id", row.id);
    if (updateErr) return jsonRes({ error: updateErr.message }, 500);

    return jsonRes({
      account_id: account.id,
      charges_enabled: Boolean(account.charges_enabled),
      payouts_enabled: Boolean(account.payouts_enabled),
      details_submitted: Boolean(account.details_submitted),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonRes({ error: msg }, 500);
  }
});
