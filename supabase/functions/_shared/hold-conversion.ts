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

import {
  buildConfirmationBody,
  formatReservationDate,
  sendReservationNotification,
} from "./reservation-notifications.ts";

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

  // 2026-05-27 BUG-fix: backfill guest_id when the hold didn't carry it.
  // create-reservation-hold passes user_profile_id but not guest_id, so the
  // hold + downstream rows (reservation, orders, deposit_payments) all end up
  // with guest_id=NULL for logged-in diners. RLS on orders/deposit_payments
  // checks guest_id, so the diner can't read their own bookings (we added a
  // user_profile_id-via-reservation path as a defense-in-depth RLS, but the
  // upstream insert should still be correct).
  //
  // Strategy: if hold.guest_id is null but a guests row exists for this
  // (user_profile_id, restaurant_id) — use it. The guests row is keyed
  // (user_profile_id, restaurant_id) so each diner has one per restaurant.
  // If no guests row exists yet, leave guest_id null; create-public-booking
  // creates the guests row when the upgrade flow runs.
  let resolvedGuestId: string | null = hold.guest_id ?? null;
  if (!resolvedGuestId) {
    // We need user_profile_id to look up — fetch from the reservation we
    // just created (it carries the profile id from the hold).
    const { data: resRow } = await supabase
      .from("reservations")
      .select("user_profile_id")
      .eq("id", reservationId)
      .maybeSingle();
    const upId = (resRow as { user_profile_id?: string | null } | null)?.user_profile_id ?? null;
    if (upId && hold.restaurant_id) {
      const { data: guestRow } = await supabase
        .from("guests")
        .select("id")
        .eq("user_profile_id", upId)
        .eq("restaurant_id", hold.restaurant_id)
        .maybeSingle();
      const guestId = (guestRow as { id?: string } | null)?.id ?? null;
      if (guestId) {
        resolvedGuestId = guestId;
        // Backfill the reservation's guest_id too so future reads (including
        // staff/analytics joins) work without the RLS workaround.
        await supabase
          .from("reservations")
          .update({ guest_id: guestId })
          .eq("id", reservationId)
          .is("guest_id", null);
      }
    }
  }

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
        guest_id: resolvedGuestId,
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

  // 4. SMS/email confirmation — fire-and-forget. Single source of truth for
  //    every hold-conversion path (no-payment via create-public-booking, paid
  //    via confirm-hold-paid, Stripe webhook race winner). 2026-05-27 fix:
  //    previously this block was a TODO and only create-public-booking sent
  //    a confirmation inline; the paid-hold flow (the dominant deposit/
  //    preorder path) sent zero notifications.
  try {
    const { data: reservation } = await supabase
      .from("reservations")
      .select(
        "id, status, guest_id, restaurant_id, party_size, reserved_at, confirmation_code, guest_full_name, guest_email, guest_phone, deposit_amount_cents",
      )
      .eq("id", reservationId)
      .maybeSingle();
    if (reservation) {
      const { data: restaurant } = await supabase
        .from("restaurants")
        .select("name, slug, timezone, phone")
        .eq("id", reservation.restaurant_id)
        .maybeSingle();
      const restaurantName = typeof restaurant?.name === "string" && restaurant.name.trim()
        ? restaurant.name.trim()
        : "the restaurant";
      const restaurantSlug = typeof restaurant?.slug === "string" && restaurant.slug.trim()
        ? restaurant.slug.trim()
        : null;
      const restaurantPhone = typeof restaurant?.phone === "string" && restaurant.phone.trim()
        ? restaurant.phone.trim()
        : null;
      const tz = (typeof restaurant?.timezone === "string" && restaurant.timezone) || "America/Toronto";
      const reservationDateLabel = formatReservationDate(new Date(reservation.reserved_at), tz);

      const guestName = reservation.guest_full_name?.trim() || "there";
      const guestEmail = reservation.guest_email || null;
      const guestPhone = reservation.guest_phone || null;

      const manageLink = restaurantSlug && reservation.confirmation_code
        ? `https://cenaiva.com/${restaurantSlug}?confirmation=${encodeURIComponent(reservation.confirmation_code)}${guestEmail ? `&email=${encodeURIComponent(guestEmail)}` : ""}`
        : null;

      const preorderItems = cartItems.length > 0
        ? cartItems
          .map((item) => ({
            name: typeof item.name === "string" ? item.name : "",
            quantity: Number(item.quantity ?? 0),
          }))
          .filter((it) => it.name && Number.isFinite(it.quantity) && it.quantity > 0)
        : null;

      // Include "Deposit paid: $X.XX" only when the diner actually paid via
      // this conversion (paymentIntentId set). No-payment holds leave the
      // line out — the deposit hasn't charged yet.
      const depositPaidCents = paymentIntentId
        && typeof reservation.deposit_amount_cents === "number"
        && reservation.deposit_amount_cents > 0
        ? reservation.deposit_amount_cents
        : null;

      const body = buildConfirmationBody({
        guestName,
        restaurantName,
        partySize: reservation.party_size,
        reservationDateLabel,
        confirmationCode: reservation.confirmation_code ?? "",
        manageLink,
        restaurantPhone,
        preorderItems,
        depositPaidCents,
      });

      await sendReservationNotification({
        supabase,
        guestId: reservation.guest_id,
        restaurantId: reservation.restaurant_id,
        reservationId: reservation.id,
        type: "reservation_confirmation",
        email: guestEmail,
        phone: guestPhone,
        subject: paymentIntentId
          ? `Your reservation at ${restaurantName} is confirmed`
          : `Your reservation at ${restaurantName}`,
        body,
      });
    }
  } catch (notifyErr) {
    console.error("runPostHoldConversion: diner confirmation failed", notifyErr);
  }
}
