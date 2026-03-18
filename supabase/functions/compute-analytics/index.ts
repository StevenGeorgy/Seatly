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
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().slice(0, 10);

    const { data: restaurants } = await supabaseAdmin.from("restaurants").select("id");
    if (!restaurants?.length) {
      return new Response(JSON.stringify({ ok: true, computed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let computed = 0;
    for (const r of restaurants) {
      const start = `${dateStr}T00:00:00Z`;
      const end = `${dateStr}T23:59:59Z`;

      const { data: orders } = await supabaseAdmin
        .from("orders")
        .select("total_amount, subtotal, tax_amount, tip_amount, discount_amount, guest_id, is_preorder, reservation_id")
        .eq("restaurant_id", r.id)
        .not("paid_at", "is", null)
        .gte("paid_at", start)
        .lte("paid_at", end);

      const { data: resvs } = await supabaseAdmin
        .from("reservations")
        .select("source, status, party_size")
        .eq("restaurant_id", r.id)
        .gte("reserved_at", start)
        .lte("reserved_at", end);

      const totalRevenue = (orders || []).reduce((s, o) => s + Number(o.total_amount || 0), 0);
      const totalOrders = orders?.length || 0;
      const paidReservationIds = [...new Set(
        (orders || []).map((o) => (o as any).reservation_id).filter(Boolean)
      )];
      const { data: paidResvs } = paidReservationIds.length
        ? await supabaseAdmin
            .from("reservations")
            .select("party_size")
            .eq("restaurant_id", r.id)
            .in("id", paidReservationIds)
        : { data: [] };
      const totalCovers = (paidResvs || []).reduce((s, r) => s + (r.party_size || 0), 0);
      const walkIn = (resvs || []).filter((x) => x.source === "walk_in").length;
      const preorder = (orders || []).filter((o) => o.is_preorder).length;
      const noShow = (resvs || []).filter((x) => x.status === "no_show").length;
      const cancelled = (resvs || []).filter((x) => x.status === "cancelled").length;
      const tipTotal = (orders || []).reduce((s, o) => s + Number(o.tip_amount || 0), 0);
      const discountTotal = (orders || []).reduce((s, o) => s + Number(o.discount_amount || 0), 0);

      const { data: labour } = await supabaseAdmin
        .from("staff_clock_records")
        .select("labour_cost")
        .eq("restaurant_id", r.id)
        .gte("clocked_in_at", start)
        .lte("clocked_in_at", end);
      const labourCost = (labour || []).reduce((s, l) => s + Number(l.labour_cost || 0), 0);

      const { count: newGuests } = await supabaseAdmin
        .from("guests")
        .select("id", { count: "exact", head: true })
        .eq("restaurant_id", r.id)
        .eq("total_visits", 1)
        .gte("first_visit_at", start)
        .lte("first_visit_at", end);

      const covers = totalCovers || (orders || []).length;
      const avgSpend = covers > 0 ? totalRevenue / covers : 0;

      await supabaseAdmin.from("restaurant_analytics").upsert(
        {
          restaurant_id: r.id,
          date: dateStr,
          total_covers: covers,
          total_revenue: totalRevenue,
          total_orders: totalOrders,
          avg_spend_per_cover: avgSpend,
          no_show_count: noShow,
          cancellation_count: cancelled,
          walk_in_count: walkIn,
          preorder_count: preorder,
          tip_total: tipTotal,
          discount_total: discountTotal,
          labour_cost: labourCost,
          new_guests_count: newGuests || 0,
          returning_guests_count: Math.max(0, covers - (newGuests || 0)),
          computed_at: new Date().toISOString(),
        },
        { onConflict: "restaurant_id,date" }
      );
      computed++;
    }

    return new Response(JSON.stringify({ ok: true, computed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
