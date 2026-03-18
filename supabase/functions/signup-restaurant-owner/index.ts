import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "restaurant";
}

async function findUniqueSlug(supabase: ReturnType<typeof createClient>, baseSlug: string): Promise<string> {
  let slug = baseSlug;
  let suffix = 2;
  while (true) {
    const { data } = await supabase.from("restaurants").select("id").eq("slug", slug).maybeSingle();
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
    const email = (body.email ?? "").toString().trim().toLowerCase();
    const password = (body.password ?? "").toString();
    const fullName = (body.full_name ?? body.fullName ?? "").toString().trim();

    if (!restaurantName) {
      return new Response(
        JSON.stringify({ error: "Restaurant name is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!email) {
      return new Response(
        JSON.stringify({ error: "Email is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!password) {
      return new Response(
        JSON.stringify({ error: "Password is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!fullName) {
      return new Response(
        JSON.stringify({ error: "Full name is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const baseSlug = slugify(restaurantName);
    const slug = await findUniqueSlug(supabase, baseSlug);

    const { data: restaurant, error: restaurantError } = await supabase
      .from("restaurants")
      .insert({
        name: restaurantName,
        slug,
        plan: "free",
        is_active: true,
        timezone: "America/Toronto",
        currency: "CAD",
        country: "Canada",
      })
      .select("id")
      .single();

    if (restaurantError || !restaurant) {
      return new Response(
        JSON.stringify({ error: restaurantError?.message ?? "Failed to create restaurant" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (authError) {
      await supabase.from("restaurants").delete().eq("id", restaurant.id);
      const msg = authError.message.toLowerCase();
      if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
        return new Response(
          JSON.stringify({ error: "An account with this email already exists" }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ error: authError.message }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!authUser.user) {
      await supabase.from("restaurants").delete().eq("id", restaurant.id);
      return new Response(
        JSON.stringify({ error: "Failed to create user" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: profileRow, error: profileError } = await supabase
      .from("user_profiles")
      .insert({
        auth_user_id: authUser.user.id,
        full_name: fullName,
        email,
        role: "owner",
        restaurant_id: restaurant.id,
      })
      .select("id, email, full_name, role, restaurant_id")
      .single();

    if (profileError || !profileRow) {
      await supabase.auth.admin.deleteUser(authUser.user.id);
      await supabase.from("restaurants").delete().eq("id", restaurant.id);
      return new Response(
        JSON.stringify({ error: profileError?.message ?? "Failed to create profile" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        restaurant_id: restaurant.id,
        user_id: authUser.user.id,
        profile: {
          id: profileRow.id,
          email: profileRow.email ?? "",
          fullName: profileRow.full_name ?? "",
          role: profileRow.role,
          restaurantId: profileRow.restaurant_id,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
