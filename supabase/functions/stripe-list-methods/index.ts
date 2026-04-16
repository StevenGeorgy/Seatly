import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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

function decodeJwtPayload(token: string): Record<string, any> | null {
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

  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
    if (!token) return jsonRes({ error: "Missing authorization token" }, 401);

    const jwtPayload = decodeJwtPayload(token);
    const authUserId = jwtPayload?.sub as string | undefined;
    if (!authUserId) return jsonRes({ error: "Unauthorized" }, 401);

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
    const { default: Stripe } = await import("npm:stripe@17");
    const stripe = new Stripe(stripeKey, { apiVersion: "2024-11-20.acacia" });

    if (!profile.stripe_customer_id) {
      return jsonRes({ methods: [], mode: "live" });
    }

    const pmList = await stripe.paymentMethods.list({
      customer: profile.stripe_customer_id,
      type: "card",
    });

    // Determine default (first card in our DB for this user)
    const { data: dbCards } = await supabaseAdmin
      .from("saved_cards")
      .select("stripe_payment_method_id, is_default")
      .eq("user_profile_id", profile.id);

    const defaultPmId = dbCards?.find((c: any) => c.is_default)?.stripe_payment_method_id
      || dbCards?.[0]?.stripe_payment_method_id;

    const methods = pmList.data.map((pm) => ({
      id: pm.id,
      brand: pm.card?.brand || "card",
      last4: pm.card?.last4 || "****",
      exp_month: pm.card?.exp_month,
      exp_year: pm.card?.exp_year,
      is_default: pm.id === defaultPmId,
    }));

    return jsonRes({ methods, mode: "live" });
  } catch (err) {
    return jsonRes({ error: String(err) }, 500);
  }
});
