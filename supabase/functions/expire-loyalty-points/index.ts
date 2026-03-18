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
    const now = new Date();
    if (now.getDate() !== 1) {
      return new Response(JSON.stringify({ ok: true, expired: 0, skipped: "not 1st of month" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: restaurants } = await supabaseAdmin
      .from("restaurants")
      .select("id, loyalty_config_json")
      .eq("is_active", true);
    if (!restaurants?.length) {
      return new Response(JSON.stringify({ ok: true, expired: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let totalExpired = 0;
    const defaultInactiveMonths = 12;

    for (const r of restaurants) {
      const config = (r.loyalty_config_json || {}) as Record<string, unknown>;
      const inactiveMonths = (config.expiry_inactive_months as number) ?? defaultInactiveMonths;
      const cutoff = new Date(now);
      cutoff.setMonth(cutoff.getMonth() - inactiveMonths);
      const cutoffStr = cutoff.toISOString().slice(0, 10);

      const { data: guests } = await supabaseAdmin
        .from("guests")
        .select("id, loyalty_points_balance, last_visit_at")
        .eq("restaurant_id", r.id)
        .gt("loyalty_points_balance", 0)
        .or(`last_visit_at.lt.${cutoffStr},last_visit_at.is.null`);

      for (const g of guests || []) {
        const balance = g.loyalty_points_balance || 0;
        if (balance <= 0) continue;
        await supabaseAdmin.from("loyalty_transactions").insert({
          guest_id: g.id,
          restaurant_id: r.id,
          type: "expired",
          points: -balance,
          balance_after: 0,
          description: `Points expired (inactive ${inactiveMonths}+ months)`,
        });
        await supabaseAdmin.from("guests").update({ loyalty_points_balance: 0 }).eq("id", g.id);
        totalExpired++;
      }
    }

    return new Response(JSON.stringify({ ok: true, expired: totalExpired }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
