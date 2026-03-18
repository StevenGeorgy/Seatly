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

function normalizeScore(value: number, min: number, max: number): number {
  if (max === min) return 50;
  return Math.round(((value - min) / (max - min)) * 100);
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
    const { data: guests } = await supabaseAdmin
      .from("guests")
      .select("id, total_spend, total_visits, last_visit_at");

    if (!guests?.length) {
      return new Response(JSON.stringify({ ok: true, updated: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const spends = guests.map((g) => Number(g.total_spend || 0)).filter((s) => s > 0);
    const visits = guests.map((g) => g.total_visits || 0).filter((v) => v > 0);
    const now = Date.now();
    const recencies = guests.map((g) =>
      g.last_visit_at
        ? Math.floor((now - new Date(g.last_visit_at).getTime()) / (1000 * 60 * 60 * 24))
        : 365
    );

    const maxSpend = Math.max(...spends, 1);
    const maxVisits = Math.max(...visits, 1);
    const maxRecency = Math.max(...recencies, 1);

    let updated = 0;
    for (const g of guests) {
      const spend = Number(g.total_spend || 0);
      const visitsCount = g.total_visits || 0;
      const recency = g.last_visit_at
        ? Math.floor((now - new Date(g.last_visit_at).getTime()) / (1000 * 60 * 60 * 24))
        : 365;

      const spendScore = normalizeScore(spend, 0, maxSpend);
      const freqScore = normalizeScore(visitsCount, 0, maxVisits);
      const recencyScore = 100 - normalizeScore(recency, 0, maxRecency);

      const score = Math.min(
        100,
        Math.round(spendScore * 0.4 + freqScore * 0.3 + recencyScore * 0.3)
      );

      await supabaseAdmin.from("guests").update({ lifetime_value_score: score }).eq("id", g.id);
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
