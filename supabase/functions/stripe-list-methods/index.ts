import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getStripeClient } from "../_shared/stripe-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function jsonRes(body: unknown, status = 200) {
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

  try {
    const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!bearerToken) return jsonRes({ error: "auth_required" }, 401);
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(bearerToken);
    if (authError || !user) return jsonRes({ error: "invalid_token" }, 401);
    const authUserId = user.id;

    const { data: profile } = await supabaseAdmin
      .from("user_profiles")
      .select("id, stripe_customer_id")
      .eq("auth_user_id", authUserId)
      .single();
    if (!profile) return jsonRes({ error: "User profile not found" }, 404);

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");

    // ── Test mode: read directly from saved_cards table ──
    if (!stripeKey) {
      const { data: cards } = await supabaseAdmin
        .from("saved_cards")
        .select("id, brand, last4, exp_month, exp_year, is_default")
        .eq("user_profile_id", profile.id)
        .order("created_at", { ascending: false });

      return jsonRes({ methods: cards || [], mode: "test" });
    }

    // ── Live mode: fetch from Stripe ──
    const stripe = await getStripeClient(stripeKey);

    if (!profile.stripe_customer_id) {
      return jsonRes({ methods: [], mode: "live" });
    }

    const pmList = await stripe.paymentMethods.list({
      customer: profile.stripe_customer_id,
      type: "card",
    });

    // Map Stripe PM ids → saved_cards row UUIDs so the client can use the
    // DB row id for delete / set-default operations (RLS on saved_cards
    // checks the UUID; the Stripe pm_ id would 22P02 the eq("id", ...)
    // filter). Default flag also lives on the DB row.
    const { data: dbCards } = await supabaseAdmin
      .from("saved_cards")
      .select("id, stripe_payment_method_id, is_default")
      .eq("user_profile_id", profile.id);

    const dbByPmId = new Map<string, { id: string; is_default: boolean }>(
      (dbCards ?? [])
        .filter((c: any) => typeof c.stripe_payment_method_id === "string")
        .map((c: any) => [c.stripe_payment_method_id, { id: c.id, is_default: !!c.is_default }]),
    );

    const methods = pmList.data
      .map((pm) => {
        const dbRow = dbByPmId.get(pm.id);
        // Skip Stripe-side PMs we don't have a saved_cards row for —
        // happens when the row was deleted locally but the PM survived
        // on the Stripe customer (or vice-versa). The orphan would
        // otherwise show up uneditable from the UI.
        if (!dbRow) return null;
        return {
          id: dbRow.id,
          stripe_payment_method_id: pm.id,
          brand: pm.card?.brand || "card",
          last4: pm.card?.last4 || "****",
          exp_month: pm.card?.exp_month,
          exp_year: pm.card?.exp_year,
          is_default: dbRow.is_default,
        };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);

    return jsonRes({ methods, mode: "live" });
  } catch (err) {
    return jsonRes({ error: String(err) }, 500);
  }
});
