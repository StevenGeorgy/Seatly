// confirm-modify-payment: finalize a reservation modification after the
// diner has paid the deposit delta via Stripe.
//
// Flow:
//   1. Verify the PI succeeded.
//   2. Verify PI metadata.deposit_payment_ids includes the row we're flipping
//      (same metadata-binding pattern as confirm-deposit-paid).
//   3. Verify PI metadata.restaurant_id matches the reservation's restaurant.
//   4. Flip the pending reservation_deposit_payments row → charged.
//   5. Validate the new slot (shift availability, capacity, double-book).
//   6. Apply the modification via modify_reservation_slot RPC.
//   7. On RPC failure (e.g. slot got taken while paying), auto-refund the
//      just-paid PI and return error.
//   8. Send the modification SMS + email (with "Deposit paid: $X.XX").
//
// Anon-callable. Caller is auth'd via either:
//   - Bearer token (matches reservation.user_profile_id), OR
//   - confirmation_code + matching guest_email (guest checkout).
//
// Body: see ConfirmModifyPaymentSchema in _shared/validation/payment.ts.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { enforceRateLimit, rateLimitIdentifier, RateLimitError } from "../_shared/rate-limit.ts";
import { parseJsonBody } from "../_shared/validation/parse.ts";
import { ConfirmModifyPaymentSchema } from "../_shared/validation/payment.ts";
import { getStripeClient } from "../_shared/stripe-client.ts";
import { closureUnavailableMessage, findClosedSpecialDayForDate } from "../_shared/closures.ts";
import { localDayOfWeek, localToUTC } from "../_shared/time.ts";
import {
  formatReservationDate,
  sendReservationNotification,
} from "../_shared/reservation-notifications.ts";
import { formatCents } from "../_shared/money.ts";
import { refundPaymentIntent } from "../_shared/stripe-refund.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type DepositRow = {
  id: string;
  reservation_id: string;
  amount_cents: number;
  status: string;
  stripe_payment_intent_id: string | null;
  // 2026-05-27: cart-modify snapshot. Present only when modify-reservation
  // seeded this row via the cart branch with delta > 0. Replayed here to
  // rebuild order_items after the diner pays the delta.
  pending_cart_snapshot: CartSnapshot | null;
};

type CartSnapshotItem = {
  menu_item_id: string;
  name: string;
  quantity: number;
  unit_price_cents: number;
  line_total_cents: number;
};

type CartSnapshot = {
  items: CartSnapshotItem[];
  food_cents: number;
  tax_cents: number;
  discount_cents: number;
  applied_promo_code: string | null;
  special_request: string | null;
};

type ReservationRow = {
  id: string;
  restaurant_id: string;
  guest_id: string | null;
  user_profile_id: string | null;
  reserved_at: string;
  party_size: number;
  status: string | null;
  internal_notes: string | null;
  confirmation_code: string | null;
  guest_full_name: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  event_id: string | null;
  promotion_id: string | null;
  applied_promo_code: string | null;
};

type RestaurantRow = {
  name: string | null;
  slug: string | null;
  timezone: string | null;
  phone: string | null;
  hours_json: unknown;
  settings_json: { turnTimeMinutes?: number | null } | null;
  stripe_account_id: string | null;
};

type ShiftRow = {
  id: string;
  start_time: string | null;
  end_time: string | null;
  turn_time_minutes: number | null;
  max_covers: number | null;
};

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function parseTimeToMinutes(value: string): number | null {
  const trimmed = value.trim();
  const meridiem = trimmed.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (meridiem) {
    let hours = Number(meridiem[1]);
    const minutes = Number(meridiem[2] ?? 0);
    const period = meridiem[3].toLowerCase();
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    if (period === "pm" && hours !== 12) hours += 12;
    if (period === "am" && hours === 12) hours = 0;
    return hours * 60 + minutes;
  }
  const [hourPart, minutePart] = trimmed.split(":");
  const hours = Number(hourPart);
  const minutes = Number(minutePart ?? 0);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function shiftContainsMinute(shift: ShiftRow, minute: number): boolean {
  const start = parseTimeToMinutes(shift.start_time ?? "17:00");
  const end = parseTimeToMinutes(shift.end_time ?? "23:00");
  if (start == null || end == null) return false;
  if (end > start) return minute >= start && minute < end;
  return minute >= start || minute < end;
}

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonRes({ error: "POST only" }, 405);

  try {
    try {
      await enforceRateLimit(
        supabaseAdmin,
        "confirm-modify-payment",
        rateLimitIdentifier(req),
        { limit: 30, windowSeconds: 60 },
      );
    } catch (err) {
      if (err instanceof RateLimitError) return jsonRes({ error: err.message }, 429);
      throw err;
    }

    const parsed = await parseJsonBody(req, ConfirmModifyPaymentSchema, {
      jsonRes: (b, s) => jsonRes(b, s),
    });
    if ("response" in parsed) return parsed.response;
    const {
      reservation_id: reservationId,
      deposit_payment_row_id: legacyRowId,
      payment_intent_id: legacyPiId,
      deposit_payment_row_ids: multiRowIds,
      payment_intent_ids: multiPiIds,
      change_type: changeType = "party_delta",
      date,
      time,
      party_size: partySize,
      special_request: specialRequest = "",
      confirmation_code: providedCode = "",
      email: providedEmail = "",
    } = parsed.data;
    const isCartDelta = changeType === "cart_delta";

    // 2026-05-28 (PR-K): normalize legacy single-row + new multi-row shapes
    // into uniform arrays. Schema guarantees exactly one shape is provided.
    const rowIds: string[] = multiRowIds ?? [legacyRowId!];
    const piIds: string[] = multiPiIds ?? [legacyPiId!];
    if (rowIds.length !== piIds.length) {
      return jsonRes(
        { error: "deposit_payment_row_ids and payment_intent_ids length mismatch" },
        400,
      );
    }
    const isSplitTenderConfirm = rowIds.length >= 2;
    // Map rowId → piId (pair-position correlation provided by client).
    const piByRowId = new Map<string, string>();
    for (let i = 0; i < rowIds.length; i++) piByRowId.set(rowIds[i], piIds[i]);

    // Load reservation + ALL deposit rows.
    const { data: reservationRaw, error: reservationErr } = await supabaseAdmin
      .from("reservations")
      .select(
        "id, restaurant_id, guest_id, user_profile_id, reserved_at, party_size, status, internal_notes, confirmation_code, guest_full_name, guest_email, guest_phone, event_id, promotion_id, applied_promo_code",
      )
      .eq("id", reservationId)
      .maybeSingle();
    if (reservationErr) return jsonRes({ error: reservationErr.message }, 400);
    const reservation = reservationRaw as ReservationRow | null;
    if (!reservation) return jsonRes({ error: "Reservation not found" }, 404);

    const { data: depositRowsRaw } = await supabaseAdmin
      .from("reservation_deposit_payments")
      .select(
        "id, reservation_id, amount_cents, status, stripe_payment_intent_id, pending_cart_snapshot",
      )
      .in("id", rowIds)
      .order("created_at", { ascending: true });
    const depositRows = (depositRowsRaw ?? []) as DepositRow[];
    if (depositRows.length !== rowIds.length) {
      return jsonRes(
        { error: "One or more deposit rows not found" },
        404,
      );
    }
    for (const row of depositRows) {
      if (row.reservation_id !== reservationId) {
        return jsonRes(
          { error: "Deposit row does not match reservation" },
          400,
        );
      }
    }
    // Backwards-compat: many downstream branches reference depositRow.* as
    // if it were a single object. Use the first row as the "representative"
    // (all rows in a split-tender share the same cart snapshot).
    const depositRow = depositRows[0];
    const totalAmountCents = depositRows.reduce(
      (s, r) => s + (r.amount_cents ?? 0),
      0,
    );

    // For cart_delta confirms the deposit rows MUST carry a snapshot
    // (modify-reservation stamps it on insert). If absent, the caller
    // is likely confirming with the wrong change_type or against the
    // wrong row.
    if (isCartDelta && !depositRow.pending_cart_snapshot) {
      return jsonRes(
        {
          error:
            "Deposit row is missing its cart snapshot — cannot apply cart_delta.",
          unavailable_reason: "missing_cart_snapshot",
        },
        400,
      );
    }

    // Auth — bearer OR confirmation_code + email. Mirrors modify-reservation.
    const authHeader = req.headers.get("authorization") ?? "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    let authed = false;
    if (bearerToken) {
      const { data: { user } } = await supabaseAdmin.auth.getUser(bearerToken);
      if (user) {
        const { data: profile } = await supabaseAdmin
          .from("user_profiles")
          .select("id")
          .eq("auth_user_id", user.id)
          .maybeSingle();
        const profileId = (profile as { id: string } | null)?.id ?? null;
        if (profileId && reservation.user_profile_id === profileId) {
          authed = true;
        }
      }
    }
    if (!authed && providedCode) {
      const expectedCode = (reservation.confirmation_code ?? "").trim();
      const reservationEmail = (reservation.guest_email ?? "").trim().toLowerCase();
      if (
        expectedCode &&
        expectedCode.toLowerCase() === providedCode.trim().toLowerCase() &&
        reservationEmail &&
        reservationEmail === providedEmail.trim().toLowerCase()
      ) {
        authed = true;
      }
    }
    if (!authed) return jsonRes({ error: "Authentication required" }, 401);

    // Idempotency check (slot-aware).
    //
    // 2026-05-27 BUG-fix: the previous broad check ("already charged + PI matches
    // → return success") had a race. Stripe webhook flips the deposit row to
    // 'charged' as soon as the PI succeeds — typically ~150ms BEFORE the client
    // calls us. The old guard then short-circuited and returned success WITHOUT
    // applying the modify. Diner paid, modify never ran.
    //
    // 2026-05-28 (PR-K): now scoped across ALL rows for split-tender.
    // Correct semantics: "already charged" means money moved, but the modify
    // may or may not have been applied. Only treat as truly idempotent if we
    // can prove the change was applied:
    //   - cart_delta: pending_cart_snapshot has been cleared on every row
    //   - party_delta: reservation.party_size already matches request AND
    //                  reservation.reserved_at matches.
    const allAlreadyCharged = depositRows.every(
      (r) =>
        r.status === "charged" &&
        r.stripe_payment_intent_id != null &&
        r.stripe_payment_intent_id === piByRowId.get(r.id),
    );

    if (allAlreadyCharged) {
      const cartTrulyIdempotent =
        isCartDelta &&
        depositRows.every((r) => r.pending_cart_snapshot === null);
      const partyTrulyIdempotent =
        !isCartDelta &&
        partySize !== undefined &&
        reservation.party_size === partySize &&
        typeof date === "string" &&
        reservation.reserved_at.startsWith(date);

      if (cartTrulyIdempotent || partyTrulyIdempotent) {
        return jsonRes({
          ok: true,
          idempotent: true,
          reservation_id: reservationId,
          reserved_at: reservation.reserved_at,
          party_size: reservation.party_size,
          is_split_tender: isSplitTenderConfirm,
          deposit_adjustment: {
            kind: "charged",
            amount_cents: totalAmountCents,
            payment_intent_id: piIds.length === 1 ? piIds[0] : null,
            payment_intent_ids: piIds,
          },
        });
      }
      // Else: webhook beat us. Fall through and apply the modify. The flips
      // below are no-ops (statuses already charged); skip them to preserve
      // the original paid_at timestamps.
    }

    for (const row of depositRows) {
      const expectedPi = piByRowId.get(row.id);
      const rowAlreadyCharged =
        row.status === "charged" &&
        row.stripe_payment_intent_id != null &&
        row.stripe_payment_intent_id === expectedPi;
      if (row.status !== "pending" && !rowAlreadyCharged) {
        return jsonRes(
          {
            error: `Deposit row ${row.id} is in unexpected status: ${row.status}`,
            row_id: row.id,
          },
          409,
        );
      }
    }

    // Verify PIs with Stripe — one per row.
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) return jsonRes({ error: "Stripe is not configured" }, 500);
    const stripe = await getStripeClient(stripeKey);

    for (const row of depositRows) {
      const piId = piByRowId.get(row.id)!;
      const intent = await stripe.paymentIntents.retrieve(piId);
      if (intent.status !== "succeeded" && intent.status !== "processing") {
        return jsonRes(
          {
            error: `PaymentIntent not paid (status: ${intent.status})`,
            row_id: row.id,
            payment_intent_id: piId,
          },
          400,
        );
      }
      if ((intent.amount ?? 0) < (row.amount_cents ?? 0)) {
        return jsonRes(
          {
            error: `PaymentIntent amount (${intent.amount}¢) is less than deposit delta (${row.amount_cents}¢)`,
            row_id: row.id,
            payment_intent_id: piId,
          },
          400,
        );
      }
      const piRestaurantId = typeof intent.metadata?.restaurant_id === "string"
        ? intent.metadata.restaurant_id
        : null;
      if (!piRestaurantId || piRestaurantId !== reservation.restaurant_id) {
        return jsonRes(
          { error: "pi_restaurant_mismatch", row_id: row.id, payment_intent_id: piId },
          400,
        );
      }
      const stampedRaw = typeof intent.metadata?.deposit_payment_ids === "string"
        ? intent.metadata.deposit_payment_ids
        : "";
      const stamped = stampedRaw.split(",").map((s) => s.trim()).filter(Boolean);
      if (!stamped.includes(row.id)) {
        return jsonRes(
          { error: "pi_payment_id_mismatch", row_id: row.id, payment_intent_id: piId },
          400,
        );
      }
    }

    // Flip each pending row to charged BEFORE applying the modify, so a
    // crash between them leaves the diner paid + the system aware of the
    // payment. Skip rows the webhook already flipped (preserves paid_at).
    for (const row of depositRows) {
      const expectedPi = piByRowId.get(row.id)!;
      const rowAlreadyCharged =
        row.status === "charged" &&
        row.stripe_payment_intent_id === expectedPi;
      if (rowAlreadyCharged) continue;
      const { error: flipErr } = await supabaseAdmin
        .from("reservation_deposit_payments")
        .update({
          status: "charged",
          stripe_payment_intent_id: expectedPi,
          paid_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (flipErr) return jsonRes({ error: flipErr.message, row_id: row.id }, 400);
    }
    // After flipping, update the local depositRows so downstream code that
    // reads .status === 'charged' sees the new state.
    for (const row of depositRows) {
      row.status = "charged";
      row.stripe_payment_intent_id = piByRowId.get(row.id) ?? row.stripe_payment_intent_id;
    }

    // Refund-all-charged-rows helper, used by BOTH the cart-delta replay below
    // and the party_delta slot-validation path. If anything AFTER the delta
    // charge fails, the diner's just-charged delta is auto-refunded so they're
    // never charged for a modify that didn't apply. (Tier2: the cart-replay
    // failures previously returned an error WITHOUT refunding.)
    const refundAndError = async (
      message: string,
      reason: string,
      status = 409,
    ): Promise<Response> => {
      for (const row of depositRows) {
        const piId = piByRowId.get(row.id)!;
        const amount = row.amount_cents ?? 0;
        if (amount <= 0) continue;
        try {
          await refundPaymentIntent(
            stripe,
            piId,
            "modify_deposit_delta_auto_refund",
            amount,
          );
          await supabaseAdmin
            .from("reservation_deposit_payments")
            .update({ status: "refunded", amount_cents: 0 })
            .eq("id", row.id);
        } catch (refundErr) {
          console.error(
            `[confirm-modify-payment] auto-refund failed for row ${row.id}:`,
            refundErr instanceof Error ? refundErr.message : refundErr,
          );
        }
      }
      return jsonRes(
        { error: message, unavailable_reason: reason, refunded: true },
        status,
      );
    };

    // ═══════════════════════════════════════════════════════════════════
    // CART-DELTA BRANCH (2026-05-27)
    // ═══════════════════════════════════════════════════════════════════
    // For change_type='cart_delta', the row was seeded by modify-reservation
    // with a `pending_cart_snapshot`. Now that the diner has paid the
    // upcharge, replay the snapshot into orders + order_items + update
    // the reservation's promo. No slot/RPC validation required.
    if (isCartDelta) {
      const snap = depositRow.pending_cart_snapshot!;
      try {
        const { data: existingOrderRaw } = await supabaseAdmin
          .from("orders")
          .select("id")
          .eq("reservation_id", reservationId)
          .eq("is_preorder", true)
          .maybeSingle();
        let orderId =
          (existingOrderRaw as { id?: string } | null)?.id ?? null;
        const subtotalDollars =
          (snap.food_cents + snap.discount_cents) / 100; // pre-discount
        const taxDollars = snap.tax_cents / 100;
        const totalDollars = (snap.food_cents + snap.tax_cents) / 100;
        const discountDollars =
          snap.discount_cents > 0 ? snap.discount_cents / 100 : null;
        // 2026-05-27 BUG-fix: We reach this branch ONLY after the delta PI
        // has succeeded (caller flipped the deposit row to 'charged' just
        // above). The cart-modify is therefore paid in full at this point —
        // set order.status='paid' (and paid_at) directly, instead of resetting
        // to 'pending' and relying on the settle trigger to flip it. The
        // trigger's UPDATE races against the UPDATE below; when the trigger
        // wins, status flips back to pending and stays there. Setting paid
        // directly eliminates the race.
        if (!orderId) {
          const { data: created, error: orderErr } = await supabaseAdmin
            .from("orders")
            .insert({
              restaurant_id: reservation.restaurant_id,
              reservation_id: reservationId,
              guest_id: reservation.guest_id,
              is_preorder: true,
              order_type: "dine_in",
              status: "paid",
              paid_at: new Date().toISOString(),
              subtotal: subtotalDollars,
              tax_amount: taxDollars,
              tip_amount: 0,
              total_amount: totalDollars,
              discount_amount: discountDollars,
              payment_method: "card",
              source: "web",
              confirmation_code: reservation.confirmation_code,
            })
            .select("id")
            .single();
          if (orderErr || !created) {
            console.error(
              "[confirm-modify-payment cart] order insert failed:",
              orderErr,
            );
            return await refundAndError(
              "We couldn't record your updated pre-order, so your payment was refunded. Please try again.",
              "order_insert_failed",
              400,
            );
          }
          orderId = (created as { id: string }).id;
        } else {
          await supabaseAdmin
            .from("order_items")
            .delete()
            .eq("order_id", orderId);
          await supabaseAdmin
            .from("orders")
            .update({
              subtotal: subtotalDollars,
              tax_amount: taxDollars,
              total_amount: totalDollars,
              discount_amount: discountDollars,
              status: "paid",
              paid_at: new Date().toISOString(),
            })
            .eq("id", orderId);
        }
        if (snap.items.length > 0) {
          const { error: itemsErr } = await supabaseAdmin
            .from("order_items")
            .insert(
              snap.items.map((it) => ({
                order_id: orderId,
                menu_item_id: it.menu_item_id,
                name: it.name,
                quantity: it.quantity,
                unit_price: it.unit_price_cents / 100,
                line_total: it.line_total_cents / 100,
                status: "pending",
              })),
            );
          if (itemsErr) {
            console.error(
              "[confirm-modify-payment cart] items insert failed:",
              itemsErr,
            );
            return await refundAndError(
              "We couldn't record your updated pre-order items, so your payment was refunded. Please try again.",
              "items_insert_failed",
              400,
            );
          }
        }
        await supabaseAdmin
          .from("reservations")
          .update({
            applied_promo_code: snap.applied_promo_code,
            special_request:
              snap.special_request ?? specialRequest ?? null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", reservationId);
        // Clear the snapshot on EVERY row (split-tender stamps the same
        // snapshot on N rows; clearing one would leak stale replay state
        // and let confirm-modify-payment replay again on a retry).
        await supabaseAdmin
          .from("reservation_deposit_payments")
          .update({ pending_cart_snapshot: null })
          .in("id", rowIds);

        try {
          const { data: restRow } = await supabaseAdmin
            .from("restaurants")
            .select("name")
            .eq("id", reservation.restaurant_id)
            .maybeSingle();
          const restName =
            (restRow as { name?: string } | null)?.name?.trim() ||
            "the restaurant";
          const itemsLine =
            snap.items.length > 0
              ? `\nNew pre-order: ${snap.items
                  .map((it) => `${it.quantity}× ${it.name}`)
                  .join(", ")}`
              : "\nPre-order: (cart cleared)";
          await sendReservationNotification({
            supabase: supabaseAdmin,
            guestId: reservation.guest_id ?? null,
            restaurantId: reservation.restaurant_id,
            reservationId,
            type: "reservation_cart_modified",
            email: reservation.guest_email,
            phone: reservation.guest_phone,
            subject: `Your pre-order at ${restName} was updated`,
            body:
              `Your pre-order at ${restName} has been updated.` +
              itemsLine +
              `\nDeposit charged: ${formatCents(totalAmountCents)}` +
              (isSplitTenderConfirm
                ? ` (split across ${depositRows.length} cards)`
                : "") +
              `\nNew total: ${formatCents(snap.food_cents + snap.tax_cents)}`,
          });
        } catch (e) {
          console.warn(
            "[confirm-modify-payment cart] diner notify failed:",
            e,
          );
        }

        return jsonRes({
          ok: true,
          change_type: "cart_delta",
          reservation_id: reservationId,
          order_id: orderId,
          is_split_tender: isSplitTenderConfirm,
          deposit_adjustment: {
            kind: "charged",
            amount_cents: totalAmountCents,
            payment_intent_id: piIds.length === 1 ? piIds[0] : null,
            payment_intent_ids: piIds,
          },
          new_cart_summary: {
            items: snap.items,
            food_cents: snap.food_cents,
            tax_cents: snap.tax_cents,
            discount_cents: snap.discount_cents,
            total_cents: snap.food_cents + snap.tax_cents,
            applied_promo_code: snap.applied_promo_code,
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[confirm-modify-payment cart] replay failed:", msg);
        return await refundAndError(
          "Updating your pre-order failed, so your payment was refunded. Please try again or contact support.",
          "cart_replay_failed",
          500,
        );
      }
    }
    // ═══════════════════════════════════════════════════════════════════

    // Look up restaurant + run the same shift/capacity validation as
    // modify-reservation. Below this point, any rejection must auto-refund
    // ALL paid PIs (one per row in split-tender). Refund + row-flip happen
    // independently per row so a partial failure doesn't strand the others.
    // Slot-modify (party_delta) path. Schema enforces date/time/party_size
    // are present when change_type != 'cart_delta', so the non-null asserts
    // below are safe.
    const slotDate = date!;
    const slotTime = time!;
    const slotPartySize = partySize!;

    const { data: restaurantRaw, error: restaurantErr } = await supabaseAdmin
      .from("restaurants")
      .select("name, slug, timezone, phone, hours_json, settings_json, stripe_account_id")
      .eq("id", reservation.restaurant_id)
      .maybeSingle();
    if (restaurantErr) return refundAndError(restaurantErr.message, "restaurant_lookup_failed", 400);
    const restaurant = restaurantRaw as RestaurantRow | null;

    const timezone = restaurant?.timezone || "America/Toronto";
    const restaurantName = restaurant?.name?.trim() || "the restaurant";
    const restaurantSlug = restaurant?.slug?.trim() || null;
    const restaurantPhone = restaurant?.phone?.trim() || null;

    const closure = findClosedSpecialDayForDate(restaurant?.hours_json, slotDate);
    if (closure) {
      return refundAndError(closureUnavailableMessage(closure), "closed", 409);
    }

    const reservedAtIso = localToUTC(slotDate, slotTime, timezone);
    const reservedAt = new Date(reservedAtIso);
    if (Number.isNaN(reservedAt.getTime()) || reservedAt.getTime() < Date.now()) {
      return refundAndError("Reservation time must be in the future", "past_time", 400);
    }

    const dayOfWeek = localDayOfWeek(slotDate, timezone);
    const requestedMinute = parseTimeToMinutes(slotTime);
    const { data: shifts } = await supabaseAdmin
      .from("shifts")
      .select("id, start_time, end_time, turn_time_minutes, max_covers")
      .eq("restaurant_id", reservation.restaurant_id)
      .eq("is_active", true)
      .contains("days_of_week", [dayOfWeek])
      .returns<ShiftRow[]>();
    const selectedShift = (shifts ?? []).find((shift) =>
      requestedMinute == null ? false : shiftContainsMinute(shift, requestedMinute),
    );
    if (!selectedShift) {
      return refundAndError("No active shift is available at that time", "no_shift", 400);
    }

    const turnMinutes =
      (typeof restaurant?.settings_json?.turnTimeMinutes === "number"
        ? restaurant.settings_json.turnTimeMinutes
        : null) || selectedShift.turn_time_minutes || 90;

    const previousReservedAt = reservation.reserved_at;
    const previousPartySize = reservation.party_size;
    const previousDateLabel = formatReservationDate(new Date(previousReservedAt), timezone);
    const nextDateLabel = formatReservationDate(reservedAt, timezone);

    // Apply the modification.
    const { data: modifyRows, error: modifyError } = await supabaseAdmin.rpc(
      "modify_reservation_slot",
      {
        p_reservation_id: reservationId,
        p_restaurant_id: reservation.restaurant_id,
        p_shift_id: selectedShift.id,
        p_new_reserved_at: reservedAtIso,
        p_new_party_size: slotPartySize,
        p_turn_minutes: turnMinutes,
      },
    );
    if (modifyError) {
      const code = (modifyError as { code?: string }).code;
      if (code === "P0001") {
        return refundAndError(
          "That time was just taken. We refunded your payment.",
          "slot_taken",
          409,
        );
      }
      if (code === "P0002") {
        return refundAndError(
          "That time no longer has cover capacity. We refunded your payment.",
          "over_cover_cap",
          409,
        );
      }
      return refundAndError(modifyError.message ?? "Modification failed", "rpc_error", 400);
    }
    const modifyRow = Array.isArray(modifyRows) ? modifyRows[0] : modifyRows;
    const nextTableIds: string[] = Array.isArray(modifyRow?.out_table_ids)
      ? modifyRow.out_table_ids.filter((id: unknown): id is string => typeof id === "string")
      : [];
    if (nextTableIds.length === 0) {
      return refundAndError(
        "That time was just taken. We refunded your payment.",
        "slot_taken",
        409,
      );
    }

    // Update notes (mirror modify-reservation's bookkeeping).
    const marker = `[Diner modified booking at ${new Date().toISOString()}]`;
    const previousNotes = reservation.internal_notes?.trim();
    const internalNotes = previousNotes ? `${previousNotes}\n${marker}` : marker;
    await supabaseAdmin
      .from("reservations")
      .update({
        special_request: specialRequest || null,
        internal_notes: internalNotes,
        updated_at: new Date().toISOString(),
      })
      .eq("id", reservationId);

    // Build + send notification.
    const guestName = reservation.guest_full_name?.trim() || "there";
    const guestEmail = reservation.guest_email || null;
    const guestPhone = reservation.guest_phone || null;
    const codeLine = reservation.confirmation_code?.trim()
      ? ` Confirmation code: ${reservation.confirmation_code.trim()}.`
      : "";

    let eventLine = "";
    let promoLine = "";
    if (reservation.event_id) {
      const { data: ev } = await supabaseAdmin
        .from("events")
        .select("name")
        .eq("id", reservation.event_id)
        .maybeSingle<{ name: string | null }>();
      if (ev?.name) eventLine = ` Event: ${ev.name}.`;
    }
    if (reservation.promotion_id) {
      const { data: pr } = await supabaseAdmin
        .from("promotions")
        .select("title, promo_code")
        .eq("id", reservation.promotion_id)
        .maybeSingle<{ title: string | null; promo_code: string | null }>();
      if (pr?.title) {
        const codePart = pr.promo_code ? ` (code ${pr.promo_code})` : "";
        promoLine = ` Promo: ${pr.title}${codePart}.`;
      }
    } else if (reservation.applied_promo_code) {
      promoLine = ` Promo code: ${reservation.applied_promo_code}.`;
    }

    // Body enrichment: include preorder items so the diner can see what
    // they had ordered alongside the updated time/party + deposit charged.
    const { data: orderRow } = await supabaseAdmin
      .from("orders")
      .select("id, order_items(name, quantity)")
      .eq("reservation_id", reservationId)
      .eq("is_preorder", true)
      .maybeSingle();
    const preorderItemsList =
      orderRow && Array.isArray((orderRow as { order_items?: unknown }).order_items)
        ? ((orderRow as { order_items: Array<{ name?: unknown; quantity?: unknown }> }).order_items)
          .map((it) => ({
            name: typeof it.name === "string" ? it.name : "",
            quantity: typeof it.quantity === "number" ? it.quantity : Number(it.quantity ?? 1),
          }))
          .filter((it) => it.name && Number.isFinite(it.quantity) && it.quantity > 0)
        : [];
    const preorderLine = preorderItemsList.length > 0
      ? `\nPre-ordered: ${preorderItemsList.map((it) => `${it.quantity}× ${it.name}`).join(", ")}`
      : "";

    const body =
      `Hi ${guestName}, your reservation at ${restaurantName} was updated from ${previousDateLabel} ` +
      `to ${nextDateLabel} for ${slotPartySize} ${slotPartySize === 1 ? "guest" : "guests"}.` +
      codeLine + eventLine + promoLine +
      preorderLine +
      `\nDeposit charged: ${formatCents(totalAmountCents)}` +
      (isSplitTenderConfirm
        ? ` (split across ${depositRows.length} cards)`
        : "") +
      (restaurantPhone ? `\nNeed to reach the restaurant directly? Call ${restaurantPhone}.` : "");
    void restaurantSlug; // reserved for future manage-link inclusion in modify SMS
    await sendReservationNotification({
      supabase: supabaseAdmin,
      guestId: reservation.guest_id ?? null,
      restaurantId: reservation.restaurant_id,
      reservationId,
      type: "reservation_modification",
      email: guestEmail,
      phone: guestPhone,
      subject: `Your reservation at ${restaurantName} was updated`,
      body,
    });

    return jsonRes({
      ok: true,
      reservation_id: reservationId,
      reserved_at: reservedAtIso,
      party_size: slotPartySize,
      table_ids: nextTableIds,
      previous_reserved_at: previousReservedAt,
      previous_party_size: previousPartySize,
      is_split_tender: isSplitTenderConfirm,
      deposit_adjustment: {
        kind: "charged",
        amount_cents: totalAmountCents,
        payment_intent_id: piIds.length === 1 ? piIds[0] : null,
        payment_intent_ids: piIds,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonRes({ error: msg }, 500);
  }
});
