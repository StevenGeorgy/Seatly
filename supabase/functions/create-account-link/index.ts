// create-account-link: returns a Stripe-hosted Account Link URL for
// Connect onboarding. Bulletproof fallback for restaurants whose Embedded
// Components iframe fails to authenticate (some platform setups don't
// work with Embedded; hosted always works).
//
// The diner is redirected to connect.stripe.com to complete KYC, then
// Stripe redirects back to `return_url` once done.
//
// Auth: caller must own the restaurant. We decode the JWT ourselves —
// verify_jwt = false in config.toml because ES256 tokens would otherwise
// 401 at the gateway before our handler runs.

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

const APP_ORIGIN = Deno.env.get("APP_ORIGIN") ?? "https://cenaiva.com";

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
        "create-account-link",
        rateLimitIdentifier(req, user.id),
        { limit: 30, windowSeconds: 60 },
      );
    } catch (err) {
      if (err instanceof RateLimitError) return jsonRes({ error: err.message }, 429);
      throw err;
    }

    const isOwner = await isOwnerOfRestaurant(supabaseAdmin, user.id, restaurantId);
    if (!isOwner) return jsonRes({ error: "Not authorized for this restaurant" }, 403);

    const { data: restaurant, error: restErr } = await supabaseAdmin
      .from("restaurants")
      .select("id, stripe_account_id")
      .eq("id", restaurantId)
      .maybeSingle();
    if (restErr || !restaurant) return jsonRes({ error: "Restaurant not found" }, 404);

    const row = restaurant as { id: string; stripe_account_id: string | null };
    if (!row.stripe_account_id) {
      return jsonRes(
        { error: "Stripe account not created yet — call create-stripe-account first" },
        400,
      );
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) return jsonRes({ error: "Stripe is not configured on the server" }, 500);

    const stripe = await getStripeClient(stripeKey);

    // Pick the redirect origin: prefer client-supplied (so localhost dev
    // works) but allow-list to known origins to avoid open-redirect risk.
    // Falls back to APP_ORIGIN env (prod default).
    const ALLOWED_ORIGINS = new Set([
      "https://cenaiva.com",
      "https://www.cenaiva.com",
      "https://localhost:5173",
      "http://localhost:5173",
      "https://localhost:5174",
      "http://localhost:5174",
    ]);
    const requestedOrigin = (parsed.data as { app_origin?: unknown }).app_origin;
    const originHeader = req.headers.get("origin");
    const candidates: (string | undefined)[] = [
      typeof requestedOrigin === "string" ? requestedOrigin : undefined,
      originHeader ?? undefined,
    ];
    const chosenOrigin = candidates.find(
      (c): c is string => !!c && ALLOWED_ORIGINS.has(c),
    ) ?? APP_ORIGIN;

    // Return path: caller supplies the page to land on after Stripe finishes.
    // Wizard passes `/setup?step=8` (default); dashboard surfaces pass the
    // current dashboard route. Allow-list to relative paths only — never
    // accept absolute URLs (would leak Stripe traffic to other hosts).
    const DEFAULT_RETURN_PATH = "/setup?step=8";
    const requestedReturnPath = (parsed.data as { return_path?: unknown }).return_path;
    const safeReturnPath = (() => {
      if (typeof requestedReturnPath !== "string") return DEFAULT_RETURN_PATH;
      // Must start with / and not be a protocol-relative URL or contain a host.
      if (!requestedReturnPath.startsWith("/")) return DEFAULT_RETURN_PATH;
      if (requestedReturnPath.startsWith("//")) return DEFAULT_RETURN_PATH;
      return requestedReturnPath;
    })();
    // Stamp Stripe-return params so the destination page can poll fresh state.
    const sep = safeReturnPath.includes("?") ? "&" : "?";
    const returnUrlBase = `${chosenOrigin}${safeReturnPath}${sep}stripe=return&restaurant_id=${row.id}`;
    const refreshUrlBase = `${chosenOrigin}${safeReturnPath}${sep}stripe=refresh&restaurant_id=${row.id}`;

    // Link type: 'onboarding' (default) for initial KYC + any incomplete
    // requirements. 'update' for verified accounts that just want to
    // change banking info / business details — Stripe scopes the hosted
    // UI to edits only, no re-onboarding noise.
    const requestedLinkType = (parsed.data as { link_type?: unknown }).link_type;
    const linkType: "account_onboarding" | "account_update" =
      requestedLinkType === "update" ? "account_update" : "account_onboarding";

    // Stripe-hosted onboarding/update link. `refresh_url` is hit if the
    // link expires before the user completes (e.g. browser tab left open
    // overnight). `return_url` is hit on successful completion AND when
    // the user clicks "Save for later" — the page must poll Stripe via
    // `accounts.retrieve` to determine whether KYC is actually done.
    const accountLink = await stripe.accountLinks.create({
      account: row.stripe_account_id,
      refresh_url: refreshUrlBase,
      return_url: returnUrlBase,
      type: linkType,
    });

    return jsonRes({ url: accountLink.url, expires_at: accountLink.expires_at });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[create-account-link] threw", msg);
    return jsonRes({ error: msg }, 500);
  }
});
