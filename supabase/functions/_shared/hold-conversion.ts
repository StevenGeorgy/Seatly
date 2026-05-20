// @ts-nocheck
// Shared post-conversion side-effects helper for reservation_holds → reservations.
// Called by:
//   - confirm-hold-paid (Agent B2)              — diner-side hold checkout
//   - create-public-booking (hold-id branch)    — no-payment hold conversion
//   - stripe-webhook (Agent B2)                 — webhook-side fallback / race winner
//
// Side effects (best-effort; failures are logged but do NOT throw — the
// reservation row already exists by the time we run here, so we never want
// to block the diner's confirmation just because a downstream insert hiccuped):
//   1. Fetch the hold for cart_snapshot, promotion_id, etc.
//   2. If the hold had a cart, create the orders + order_items rows and
//      back-link the reservation via preorder_order_id.
//   3. Increment promotion_id usage if a promo was applied.
//   4. (Future) Fire-and-forget SMS/email confirmation.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface RunPostHoldConversionArgs {
  supabase: SupabaseClient;
  holdId: string;
  reservationId: string;
  paymentIntentId: string | null;
}

interface CartSnapshot {
  items?: Array<Record<string, unknown>>;
  subtotal?: number;
  tax_amount?: number;
  tip_amount?: number;
}

interface HoldRow {
  cart_snapshot: CartSnapshot | null;
  total_amount_cents: number | null;
  promotion_id: string | null;
  applied_promo_code: string | null;
  restaurant_id: string;
  guest_id: string | null;
  guest_email: string | null;
  guest_full_name: string | null;
  source: string | null;
}

export async function runPostHoldConversion({
  supabase,
  holdId,
  reservationId,
  paymentIntentId,
}: RunPostHoldConversionArgs): Promise<void> {
  // 1. Fetch the hold to get cart_snapshot, promotion_id, etc.
  const { data: holdRow, error: holdErr } = await supabase
    .from("reservation_holds")
    .select(
      "cart_snapshot, total_amount_cents, promotion_id, applied_promo_code, restaurant_id, guest_id, guest_email, guest_full_name, source",
    )
    .eq("id", holdId)
    .maybeSingle();
  if (holdErr || !holdRow) {
    console.error("runPostHoldConversion: hold fetch failed", holdErr);
    return;
  }
  const hold = holdRow as HoldRow;

  // 2. If cart_snapshot has items, create an orders row from it.
  const cartItems = Array.isArray(hold.cart_snapshot?.items)
    ? (hold.cart_snapshot!.items as Array<Record<string, unknown>>)
    : [];
  if (cartItems.length > 0) {
    const totalCents = typeof hold.total_amount_cents === "number" ? hold.total_amount_cents : 0;
    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .insert({
        restaurant_id: hold.restaurant_id,
        reservation_id: reservationId,
        guest_id: hold.guest_id,
        is_preorder: true,
        order_type: "dine_in",
        status: paymentIntentId ? "paid" : "pending",
        subtotal: hold.cart_snapshot?.subtotal ?? 0,
        tax_amount: hold.cart_snapshot?.tax_amount ?? 0,
        tip_amount: hold.cart_snapshot?.tip_amount ?? 0,
        total_amount: totalCents / 100,
        payment_method: paymentIntentId ? "card" : "cash",
        stripe_payment_intent_id: paymentIntentId,
        source: hold.source ?? "web",
      })
      .select("id")
      .single();
    if (orderErr || !order) {
      console.error("runPostHoldConversion: order insert failed", orderErr);
    } else {
      const orderId = order.id as string;
      const { error: itemsErr } = await supabase.from("order_items").insert(
        cartItems.map((item: Record<string, unknown>) => {
          const qty = Number(item.quantity ?? 0);
          const unit = Number(item.unit_price ?? 0);
          return {
            order_id: orderId,
            status: paymentIntentId ? "paid" : "pending",
            menu_item_id: item.menu_item_id,
            name: item.name,
            quantity: qty,
            unit_price: unit,
            // line_total is NOT NULL in the schema with no default; the
            // restaurant dashboard reads this column directly so we have to
            // compute it here rather than relying on the DB to derive it.
            line_total: Math.round(qty * unit * 100) / 100,
          };
        }),
      );
      if (itemsErr) {
        console.error("runPostHoldConversion: order_items insert failed", itemsErr);
      }
      // Link order to reservation for the existing preorder_order_id read path.
      const { error: linkErr } = await supabase
        .from("reservations")
        .update({ preorder_order_id: orderId })
        .eq("id", reservationId);
      if (linkErr) {
        console.error("runPostHoldConversion: reservation preorder link failed", linkErr);
      }
    }
  }

  // 3. Increment promotion usage if a promo was applied. Mirrors the inline
  //    pattern in create-public-booking — no dedicated increment RPC exists,
  //    so we do a read + write rather than relying on an RPC that isn't there.
  if (hold.promotion_id) {
    try {
      const { data: promo } = await supabase
        .from("promotions")
        .select("current_uses")
        .eq("id", hold.promotion_id)
        .eq("restaurant_id", hold.restaurant_id)
        .maybeSingle();
      if (promo) {
        await supabase
          .from("promotions")
          .update({ current_uses: Number(promo.current_uses ?? 0) + 1 })
          .eq("id", hold.promotion_id);
      }
    } catch (e) {
      console.error("runPostHoldConversion: promotion usage increment failed", e);
    }
  }

  // 4. SMS/email confirmation — fire-and-forget. Skipped here; the existing
  //    inline notify in create-public-booking still runs for the legacy path,
  //    and confirm-hold-paid / stripe-webhook can wire send-booking-confirmation
  //    when those agents land.
}
