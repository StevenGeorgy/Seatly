import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// Returns the order + linked reservation + items by order_id, bypassing RLS.
// Used by the customer's prepay→checkout deep-link from Cenaiva: the customer
// is unauthenticated, so the standard `orders_select_own` RLS policy (which
// requires auth.uid() to match the linked guest) returns null. The order_id
// UUID acts as a capability token — anyone with the link can view the order.
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const orderId =
      url.searchParams.get("order_id") ||
      (await req.json().catch(() => ({}))).order_id;

    if (!orderId) {
      return new Response(
        JSON.stringify({ error: "order_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Use three separate queries instead of PostgREST embeds — the embedded
    // `reservations(...)` join was returning null (likely because PostgREST's
    // schema cache couldn't disambiguate the FK). Service-role access bypasses
    // RLS, so we just need the direct rows.
    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("id, notes, reservation_id")
      .eq("id", orderId)
      .single();

    if (orderErr || !order) {
      return new Response(
        JSON.stringify({ error: "Order not found", detail: orderErr?.message ?? null }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: orderItems } = await supabase
      .from("order_items")
      .select("name, quantity, unit_price, modifications, menu_item_id")
      .eq("order_id", orderId);

    let reservation: unknown = null;
    if (order.reservation_id) {
      const { data: resv } = await supabase
        .from("reservations")
        .select(
          "id, reserved_at, party_size, guest_full_name, guest_email, guest_phone, special_request, occasion",
        )
        .eq("id", order.reservation_id)
        .single();
      reservation = resv ?? null;
    }

    return new Response(
      JSON.stringify({
        order: {
          ...order,
          order_items: orderItems ?? [],
          reservations: reservation,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
