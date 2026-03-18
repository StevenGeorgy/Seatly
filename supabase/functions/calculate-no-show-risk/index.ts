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
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (!verifyCronSecret(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { data: guests } = await supabaseAdmin
      .from("guests")
      .select("id, no_show_count, total_visits, last_visit_at")
      .gt("total_visits", 0);

    if (!guests?.length) {
      return new Response(
        JSON.stringify({ ok: true, updated: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let updated = 0;
    for (const g of guests) {
      const noShowRatio = g.no_show_count / g.total_visits;
      const baseScore = Math.min(100, Math.round(noShowRatio * 60));
      const recencyDays = g.last_visit_at
        ? Math.floor(
            (Date.now() - new Date(g.last_visit_at).getTime()) / (1000 * 60 * 60 * 24)
          )
        : 365;
      const recencyWeight = Math.min(20, Math.floor(recencyDays / 30) * 2);
      const score = Math.min(100, baseScore + recencyWeight);

      await supabaseAdmin
        .from("guests")
        .update({ no_show_risk_score: score })
        .eq("id", g.id);
      updated++;
    }

    return new Response(
      JSON.stringify({ ok: true, updated }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
