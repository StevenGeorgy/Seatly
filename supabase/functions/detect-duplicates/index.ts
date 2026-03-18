import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const restaurantId = body.restaurant_id;
    const phone = body.phone?.trim?.() || null;
    const email = body.email?.trim?.() || null;

    if (!restaurantId || (!phone && !email)) {
      return new Response(
        JSON.stringify({ error: "restaurant_id and (phone or email) required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let query = supabase
      .from("guests")
      .select("id, full_name, email, phone, total_visits, last_visit_at")
      .eq("restaurant_id", restaurantId)
      .is("duplicate_of", null);

    if (phone && email) {
      query = query.or(`phone.eq.${phone},email.eq.${email}`);
    } else if (phone) {
      query = query.eq("phone", phone);
    } else {
      query = query.eq("email", email);
    }

    const { data: guests, error } = await query;

    if (error) {
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const normalized = (guests || []).map((g) => ({
      id: g.id,
      full_name: g.full_name,
      email: g.email,
      phone: g.phone,
      total_visits: g.total_visits,
      last_visit_at: g.last_visit_at,
    }));

    return new Response(
      JSON.stringify({ duplicates: normalized, count: normalized.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
