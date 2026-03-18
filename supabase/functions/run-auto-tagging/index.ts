import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

function verifyCronSecret(req: Request): boolean {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret) return true;
  return req.headers.get("x-cron-secret") === secret;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (!verifyCronSecret(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { data: guests } = await supabaseAdmin.from("guests").select("*");
    if (!guests?.length) {
      return new Response(JSON.stringify({ ok: true, updated: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: restaurants } = await supabaseAdmin
      .from("restaurants")
      .select("id")
      .eq("is_active", true);
    const restaurantIds = new Set((restaurants || []).map((r) => r.id));

    const now = new Date();
    const month = now.getMonth();
    const day = now.getDate();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    let updated = 0;
    for (const g of guests) {
      if (!restaurantIds.has(g.restaurant_id)) continue;

      const tags: string[] = [];
      const totalVisits = g.total_visits || 0;
      const lastVisit = g.last_visit_at ? new Date(g.last_visit_at) : null;
      const lifetimeScore = g.lifetime_value_score ?? 0;
      const noShowScore = g.no_show_risk_score ?? 0;
      const avgSpend = Number(g.average_spend_per_visit || 0);
      const birthday = g.birthday ? new Date(g.birthday) : null;
      const anniversary = g.anniversary ? new Date(g.anniversary) : null;

      if (totalVisits >= 5) tags.push("Regular");
      if (totalVisits >= 15) tags.push("Loyal");
      if (lifetimeScore >= 80) tags.push("VIP");
      if (totalVisits === 1) tags.push("New Guest");
      if (
        lastVisit &&
        lastVisit < ninetyDaysAgo &&
        totalVisits >= 3
      )
        tags.push("Lapsed");
      if (noShowScore >= 60) tags.push("No-show Risk");
      if (birthday && birthday.getMonth() === month) tags.push("Birthday This Month");
      if (anniversary && anniversary.getMonth() === month)
        tags.push("Anniversary This Month");

      const { data: topSpenders } = await supabaseAdmin
        .from("guests")
        .select("id")
        .eq("restaurant_id", g.restaurant_id)
        .not("average_spend_per_visit", "is", null)
        .order("average_spend_per_visit", { ascending: false })
        .limit(Math.ceil(guests.filter((x) => x.restaurant_id === g.restaurant_id).length * 0.1));
      const topIds = new Set((topSpenders || []).map((x) => x.id));
      if (topIds.has(g.id) && avgSpend > 0) tags.push("High Spender");

      await supabaseAdmin.from("guests").update({ tags }).eq("id", g.id);
      updated++;
    }

    return new Response(JSON.stringify({ ok: true, updated }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
