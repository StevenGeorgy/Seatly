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
    const reservationId = body.reservation_id;

    if (!reservationId) {
      return new Response(
        JSON.stringify({ error: "reservation_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: resv, error: resvErr } = await supabase
      .from("reservations")
      .select("id, restaurant_id, guest_id, table_id, status")
      .eq("id", reservationId)
      .single();

    if (resvErr || !resv) {
      return new Response(
        JSON.stringify({ error: "Reservation not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!["pending", "confirmed"].includes(resv.status)) {
      return new Response(
        JSON.stringify({ error: "Reservation already checked in or completed" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { error: updateErr } = await supabase
      .from("reservations")
      .update({
        checked_in_at: new Date().toISOString(),
        status: "seated",
      })
      .eq("id", reservationId);

    if (updateErr) {
      return new Response(
        JSON.stringify({ error: updateErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: existingOrder } = await supabase
      .from("orders")
      .select("id")
      .eq("reservation_id", reservationId)
      .single();

    if (!existingOrder) {
      await supabase.from("orders").insert({
        reservation_id: reservationId,
        restaurant_id: resv.restaurant_id,
        guest_id: resv.guest_id,
        table_id: resv.table_id,
        status: "pending",
        is_preorder: false,
      });
    }

    return new Response(
      JSON.stringify({ ok: true, reservation_id: reservationId, checked_in_at: new Date().toISOString() }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
