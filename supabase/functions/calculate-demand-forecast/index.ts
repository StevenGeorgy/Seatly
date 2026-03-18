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
    const url = new URL(req.url);
    const restaurantId = url.searchParams.get("restaurant_id");
    const days = parseInt(url.searchParams.get("days") || "14", 10);

    if (!restaurantId) {
      return new Response(
        JSON.stringify({ error: "restaurant_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + days);
    const startStr = today.toISOString().slice(0, 10);
    const endStr = endDate.toISOString().slice(0, 10);

    const { data: reservations } = await supabase
      .from("reservations")
      .select("reserved_at, party_size")
      .eq("restaurant_id", restaurantId)
      .in("status", ["pending", "confirmed"])
      .gte("reserved_at", `${startStr}T00:00:00`)
      .lte("reserved_at", `${endStr}T23:59:59`);

    const byDate: Record<string, { covers: number; count: number }> = {};
    for (const r of reservations || []) {
      const d = (r.reserved_at as string).slice(0, 10);
      if (!byDate[d]) byDate[d] = { covers: 0, count: 0 };
      byDate[d].covers += r.party_size || 0;
      byDate[d].count += 1;
    }

    const forecast = Object.entries(byDate)
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const avgCovers = forecast.length
      ? Math.round(forecast.reduce((s, f) => s + f.covers, 0) / forecast.length)
      : 0;
    const avgCount = forecast.length
      ? Math.round(forecast.reduce((s, f) => s + f.count, 0) / forecast.length)
      : 0;

    return new Response(
      JSON.stringify({
        forecast,
        summary: { avg_covers_per_day: avgCovers, avg_reservations_per_day: avgCount },
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
