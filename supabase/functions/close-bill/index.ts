import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { parseJsonBody } from "../_shared/validation/parse.ts";
import { CloseBillSchema } from "../_shared/validation/reservation-hold.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const parsed = await parseJsonBody(req, CloseBillSchema, {
      jsonRes: (b, s) => jsonRes(b, s),
    });
    if ("response" in parsed) return parsed.response;
    const orderId = parsed.data.order_id;
    const tipAmount = parsed.data.tip_amount ?? 0;
    const paymentMethod = parsed.data.payment_method || "card";

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

    const { data: order, error: fetchErr } = await supabase
      .from("orders")
      .select("id, subtotal, tax_amount, discount_amount")
      .eq("id", orderId)
      .single();

    if (fetchErr || !order) {
      return new Response(
        JSON.stringify({ error: "Order not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const subtotal = Number(order.subtotal || 0);
    const taxAmount = Number(order.tax_amount || 0);
    const discountAmount = Number(order.discount_amount || 0);
    const totalAmount = subtotal + taxAmount - discountAmount + Number(tipAmount);

    const { error: updateErr } = await supabase
      .from("orders")
      .update({
        tip_amount: tipAmount,
        total_amount: totalAmount,
        payment_method: paymentMethod,
        status: "paid",
        paid_at: new Date().toISOString(),
        billed_at: new Date().toISOString(),
      })
      .eq("id", orderId);

    if (updateErr) {
      return new Response(
        JSON.stringify({ error: updateErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ ok: true, order_id: orderId, paid_at: new Date().toISOString() }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
