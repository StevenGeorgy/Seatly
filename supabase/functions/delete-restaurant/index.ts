import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type RequestBody = {
  restaurant_id?: unknown;
  restaurantId?: unknown;
  confirmationName?: unknown;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const authHeader = req.headers.get("Authorization") ?? "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!bearerToken) return json({ error: "Authentication required" }, 401);

    const {
      data: { user },
      error: userError,
    } = await adminClient.auth.getUser(bearerToken);
    if (userError || !user) return json({ error: "Invalid or expired session" }, 401);

    const body = (await req.json().catch(() => ({}))) as RequestBody;
    const restaurantId = cleanString(body.restaurant_id ?? body.restaurantId);
    const confirmationName = cleanString(body.confirmationName);
    if (!restaurantId) return json({ error: "restaurant_id is required" }, 400);
    if (!confirmationName) return json({ error: "confirmationName is required" }, 400);

    const { data: profile, error: profileError } = await adminClient
      .from("user_profiles")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (profileError || !profile) return json({ error: "User profile not found" }, 403);

    const { data: restaurant, error: restaurantError } = await adminClient
      .from("restaurants")
      .select("id, name")
      .eq("id", restaurantId)
      .maybeSingle();
    if (restaurantError) return json({ error: restaurantError.message }, 400);
    if (!restaurant) return json({ error: "Restaurant not found" }, 404);
    if ((restaurant.name ?? "").trim() !== confirmationName) {
      return json({ error: "Restaurant name confirmation does not match" }, 400);
    }

    const { data: ownerRows, error: roleError } = await adminClient
      .from("user_restaurant_roles")
      .select("id")
      .eq("restaurant_id", restaurantId)
      .eq("user_id", profile.id)
      .eq("role", "owner");
    if (roleError || !ownerRows || ownerRows.length === 0) {
      return json({ error: "Only restaurant owners can delete a restaurant" }, 403);
    }

    // payments.restaurant_id has no ON DELETE CASCADE in the current schema.
    const { error: paymentsError } = await adminClient
      .from("payments")
      .delete()
      .eq("restaurant_id", restaurantId);
    if (paymentsError && paymentsError.code !== "42P01") {
      return json({ error: paymentsError.message }, 400);
    }

    const { error: deleteError } = await adminClient
      .from("restaurants")
      .delete()
      .eq("id", restaurantId);
    if (deleteError) return json({ error: deleteError.message }, 400);

    await adminClient
      .from("user_restaurant_roles")
      .delete()
      .eq("restaurant_id", restaurantId);

    await adminClient
      .from("user_profiles")
      .update({ restaurant_id: null })
      .eq("restaurant_id", restaurantId);

    return json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return json({ error: message }, 500);
  }
});
