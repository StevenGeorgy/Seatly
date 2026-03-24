import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "restaurant"
  );
}

async function findUniqueSlug(
  supabase: ReturnType<typeof createClient>,
  baseSlug: string,
): Promise<string> {
  let slug = baseSlug;
  let suffix = 2;
  while (true) {
    const { data } = await supabase
      .from("restaurants")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (!data) return slug;
    slug = `${baseSlug}-${suffix}`;
    suffix++;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const restaurantName = (body.restaurant_name ?? body.restaurantName ?? "").toString().trim();

    if (!restaurantName) {
      return new Response(
        JSON.stringify({ error: "Restaurant name is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Service-role client for privileged operations (bypasses RLS)
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── Resolve the user ──────────────────────────────────────────────────────
    // Flow A: caller is already authenticated — use their JWT
    // Flow B: legacy sign-up flow — create a new user with email+password
    let userId: string;
    let userEmail: string;
    let userFullName: string;

    const authHeader = req.headers.get("Authorization") ?? "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (bearerToken) {
      // Verify the token and get the user
      const { data: { user }, error: userError } = await adminClient.auth.getUser(bearerToken);
      if (userError || !user) {
        return new Response(
          JSON.stringify({ error: "Invalid or expired session. Please log in again." }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      userId = user.id;
      userEmail = user.email ?? "";
      userFullName = (body.full_name ?? body.fullName ?? user.user_metadata?.full_name ?? "").toString().trim();
    } else {
      // Legacy: create a brand-new user
      const email = (body.email ?? "").toString().trim().toLowerCase();
      const password = (body.password ?? "").toString();
      const fullName = (body.full_name ?? body.fullName ?? "").toString().trim();

      if (!email || !password || !fullName) {
        return new Response(
          JSON.stringify({ error: "email, password and full_name are required for new accounts" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const { data: authUser, error: authError } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });

      if (authError || !authUser.user) {
        const msg = (authError?.message ?? "").toLowerCase();
        if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
          return new Response(
            JSON.stringify({ error: "An account with this email already exists" }),
            { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({ error: authError?.message ?? "Failed to create user" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      userId = authUser.user.id;
      userEmail = email;
      userFullName = fullName;
    }

    // ── Create the restaurant ─────────────────────────────────────────────────
    const baseSlug = slugify(restaurantName);
    const slug = await findUniqueSlug(adminClient, baseSlug);

    const depositPolicyJson = {
      requires_deposit: body.requires_deposit ?? false,
      deposit_amount: body.deposit_amount ?? null,
    };

    const loyaltyConfigJson = {
      enabled: body.loyalty_enabled ?? false,
      points_per_dollar: body.loyalty_points_per_dollar ?? 1,
    };

    const { data: restaurant, error: restaurantError } = await adminClient
      .from("restaurants")
      .insert({
        name: restaurantName,
        slug,
        plan: "free",
        is_active: true,
        timezone: body.timezone ?? "America/Toronto",
        currency: body.currency ?? "CAD",
        country: body.country ?? "Canada",
        address: body.address ?? null,
        city: body.city ?? null,
        province: body.province ?? null,
        phone: body.phone ?? null,
        description: body.description ?? null,
        cuisine_type: body.cuisine_type ?? null,
        hours_json: body.hours_json ?? null,
        accepts_walkins: body.accepts_walkins ?? true,
        no_show_fee: body.no_show_fee ?? null,
        cancellation_hours: body.cancellation_hours ?? 24,
        deposit_policy_json: depositPolicyJson,
        loyalty_config_json: loyaltyConfigJson,
      })
      .select("id")
      .single();

    if (restaurantError || !restaurant) {
      return new Response(
        JSON.stringify({ error: restaurantError?.message ?? "Failed to create restaurant" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Upsert the user profile ───────────────────────────────────────────────
    const { data: existingProfile } = await adminClient
      .from("user_profiles")
      .select("id")
      .eq("auth_user_id", userId)
      .maybeSingle();

    let profileId: string;

    if (existingProfile) {
      await adminClient
        .from("user_profiles")
        .update({ role: "owner", restaurant_id: restaurant.id })
        .eq("auth_user_id", userId);
      profileId = existingProfile.id;
    } else {
      const { data: newProfile, error: profileError } = await adminClient
        .from("user_profiles")
        .insert({
          auth_user_id: userId,
          full_name: userFullName,
          email: userEmail,
          role: "owner",
          restaurant_id: restaurant.id,
        })
        .select("id")
        .single();

      if (profileError || !newProfile) {
        await adminClient.from("restaurants").delete().eq("id", restaurant.id);
        return new Response(
          JSON.stringify({ error: profileError?.message ?? "Failed to create profile" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      profileId = newProfile.id;
    }

    // ── Create user_restaurant_roles row ──────────────────────────────────────
    // user_restaurant_roles.user_id references user_profiles.id (not auth.users.id)
    await adminClient.from("user_restaurant_roles").upsert(
      { user_id: profileId, restaurant_id: restaurant.id, role: "owner", is_primary: true },
      { onConflict: "user_id,restaurant_id" },
    );

    return new Response(
      JSON.stringify({ ok: true, restaurant_id: restaurant.id, user_id: userId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
