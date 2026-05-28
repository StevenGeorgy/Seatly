import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  formatReservationDate,
  sendReservationNotification,
} from "../_shared/reservation-notifications.ts";
import { enforceRateLimit, rateLimitIdentifier, RateLimitError } from "../_shared/rate-limit.ts";
import { sendNotifyMeSms, type FulfilledAlertRow } from "../_shared/notify-me-sms.ts";
import { refundPaymentIntent } from "../_shared/stripe-refund.ts";
import { computeBreakEvenRefund } from "../_shared/refund-math.ts";
import { formatCents } from "../_shared/money.ts";
import { parseJsonBody } from "../_shared/validation/parse.ts";
import { CancelReservationSchema } from "../_shared/validation/booking.ts";
import { notifyOwnerCancellation } from "../_shared/owner-notifications.ts";
import { getStripeClient } from "../_shared/stripe-client.ts";

type RefundOutcomeReport = {
  kind: "preorder" | "deposit";
  ok: boolean;
  payment_intent_id: string | null;
  amount_cents: number;
  error?: string;
  // 2026-05-28 (PR-K): per-payer context surfaced in the cancellation
  // notification breakdown — present on deposit rows for split-tender.
  payer_full_name?: string | null;
  payer_email?: string | null;
};

// Status semantics: this function permits cancelling reservations in any
// status except an already-`cancelled` one (idempotent OK) or a past one
// (rejected). That includes `seated`, `completed`, and `no_show` — diners
// retain the ability to retract a booking even after the meal. The release
// of `reservation_tables` happens via release_reservation_tables RPC, which
// throws on `seated` rows; we fall back to a manual UPDATE in that case so
// the cancel still completes. If business rules later require locking out
// seated/completed cancels, do it here at the top of the handler.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ReservationRow = {
  id: string;
  restaurant_id: string;
  guest_id: string;
  user_profile_id: string | null;
  reserved_at: string;
  party_size: number;
  status: string | null;
  table_id: string | null;
  confirmation_code: string | null;
  guest_full_name: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  // Event/promo linkage — needed so the cancellation SMS body can mention
  // the event name / promotion title + code the diner originally booked.
  event_id: string | null;
  promotion_id: string | null;
  applied_promo_code: string | null;
};

type ReservationTableRow = {
  table_id: string;
};

type GuestRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
};

type RestaurantRow = {
  name: string | null;
  timezone: string | null;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const parsed = await parseJsonBody(req, CancelReservationSchema, {
      jsonRes: (b, s) => json(b, s),
    });
    if ("response" in parsed) return parsed.response;
    const reservationId = parsed.data.reservation_id ?? parsed.data.reservationId!;
    const providedCode = parsed.data.confirmation_code ?? parsed.data.confirmationCode ?? "";
    const actor: "diner" | "owner" = parsed.data.actor === "owner" ? "owner" : "diner";

    const { data: reservation, error: reservationError } = await adminClient
      .from("reservations")
      .select("id, restaurant_id, guest_id, user_profile_id, reserved_at, party_size, status, table_id, confirmation_code, guest_full_name, guest_email, guest_phone, event_id, promotion_id, applied_promo_code")
      .eq("id", reservationId)
      .maybeSingle<ReservationRow>();
    if (reservationError) return json({ error: reservationError.message }, 400);
    if (!reservation) return json({ error: "Reservation not found" }, 404);

    let guest: GuestRow | null = null;
    const authHeader = req.headers.get("Authorization") ?? "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (actor === "owner") {
      // Owner-initiated cancel (from the restaurant dashboard). MUST be
      // authenticated as a user with a role on this restaurant. We don't
      // care which role — owner, manager, host, server, etc. all qualify
      // since each can already see the reservation in their dashboard.
      if (!bearerToken) {
        return json({ error: "Owner cancel requires authentication" }, 401);
      }
      const {
        data: { user },
        error: userError,
      } = await adminClient.auth.getUser(bearerToken);
      if (userError || !user) return json({ error: "Invalid or expired session" }, 401);

      const { data: profile, error: profileError } = await adminClient
        .from("user_profiles")
        .select("id")
        .eq("auth_user_id", user.id)
        .maybeSingle();
      if (profileError) return json({ error: profileError.message }, 400);
      if (!profile) return json({ error: "User profile not found" }, 403);

      const { data: roleRow, error: roleError } = await adminClient
        .from("user_restaurant_roles")
        .select("role")
        .eq("user_id", profile.id)
        .eq("restaurant_id", reservation.restaurant_id)
        .maybeSingle<{ role: string }>();
      if (roleError) return json({ error: roleError.message }, 400);
      if (!roleRow) {
        return json({ error: "You don't have permission to cancel reservations at this restaurant" }, 403);
      }
      // Look up the linked guest for the cancellation notification.
      // Guard against null guest_id — synthetic test rows and some legacy
      // bookings have no linked guest. Without the guard, supabase-js
      // serializes .eq("id", null) as ?id=eq.null which PostgreSQL parses
      // as the literal string 'null'::uuid → "invalid input syntax for
      // type uuid" 400.
      if (reservation.guest_id) {
        const { data: linkedGuest } = await adminClient
          .from("guests")
          .select("id, full_name, email, phone")
          .eq("id", reservation.guest_id)
          .maybeSingle<GuestRow>();
        guest = linkedGuest;
      }
    } else if (bearerToken) {
      // Diner-initiated cancel (logged-in path).
      const {
        data: { user },
        error: userError,
      } = await adminClient.auth.getUser(bearerToken);
      if (userError || !user) return json({ error: "Invalid or expired session" }, 401);

      const { data: profile, error: profileError } = await adminClient
        .from("user_profiles")
        .select("id")
        .eq("auth_user_id", user.id)
        .maybeSingle();
      if (profileError) return json({ error: profileError.message }, 400);
      if (!profile) return json({ error: "User profile not found" }, 403);
      const profileId = (profile as { id: string }).id;

      // Authorize: primary check is reservation.user_profile_id matching
      // this user's profile (set when the diner booked while signed in).
      // Guest-row ownership is the fallback for legacy or guest-checkout
      // bookings linked to a profile after the fact.
      let authorized = reservation.user_profile_id === profileId;
      if (!authorized && reservation.guest_id) {
        const { data: ownedRow, error: ownedError } = await adminClient
          .from("guests")
          .select("id")
          .eq("id", reservation.guest_id)
          .eq("user_profile_id", profileId)
          .maybeSingle<{ id: string }>();
        if (ownedError) return json({ error: ownedError.message }, 400);
        authorized = ownedRow !== null;
      }
      if (!authorized) {
        return json({ error: "You can only cancel your own reservations" }, 403);
      }

      // Look up the linked guest for the cancellation notification — same
      // null guard as the owner branch.
      if (reservation.guest_id) {
        const { data: linkedGuest } = await adminClient
          .from("guests")
          .select("id, full_name, email, phone")
          .eq("id", reservation.guest_id)
          .maybeSingle<GuestRow>();
        guest = linkedGuest;
      }
    } else if (providedCode) {
      // Diner-initiated cancel (guest path with confirmation code + email).
      //
      // SECURITY: code-only auth was vulnerable to enumeration of the
      // ~1.6M SEAT-XXXX space. Now we require the matching guest_email
      // alongside the code (mirrors find-reservation). The email is on
      // the same confirmation message that contained the code, so any
      // legitimate diner has access to both.
      const expectedCode = (reservation.confirmation_code ?? "").trim();
      if (!expectedCode || expectedCode.toLowerCase() !== providedCode.toLowerCase()) {
        return json({ error: "Invalid confirmation code" }, 401);
      }
      const providedEmail = (parsed.data.email ?? "").trim().toLowerCase();
      const reservationEmail = (reservation.guest_email ?? "").trim().toLowerCase();
      if (!providedEmail || !reservationEmail || providedEmail !== reservationEmail) {
        // Don't reveal which field failed — both 401s look identical.
        return json({ error: "Invalid confirmation code" }, 401);
      }
      if (reservation.guest_id) {
        const { data: linkedGuest } = await adminClient
          .from("guests")
          .select("id, full_name, email, phone")
          .eq("id", reservation.guest_id)
          .maybeSingle<GuestRow>();
        guest = linkedGuest;
      }
    } else {
      return json({ error: "Authentication required" }, 401);
    }

    // Rate limit. Lower than booking (20/min) and modify (15/min) — cancel
    // shouldn't happen in bursts. Bucket per logged-in diner when present,
    // otherwise per IP (and a confirmation_code path effectively gets per-IP).
    try {
      await enforceRateLimit(
        adminClient,
        "cancel",
        rateLimitIdentifier(req, reservation.user_profile_id ?? null),
        { limit: 10, windowSeconds: 60 },
      );
    } catch (e) {
      if (e instanceof RateLimitError) {
        return json({ error: e.message, unavailable_reason: "rate_limited" }, 429);
      }
      throw e;
    }

    if (reservation.status === "cancelled") {
      return json({ ok: true, reservation_id: reservationId, status: "cancelled" });
    }

    // 2026-05-22 defensive gate: refuse to cancel reservations that have
    // already been seated, completed, or marked no-show. The UI hides the
    // cancel button for these statuses, but a direct-API call (owner or
    // diner) could otherwise trigger a refund for a meal that already
    // happened. The past-time check below also catches most of these, but
    // a `seated` reservation whose reserved_at is still in the future
    // (rare: a party hosted slightly early) is only caught by this check.
    const finalStatuses = new Set(["seated", "completed", "no_show"]);
    if (reservation.status && finalStatuses.has(reservation.status)) {
      return json({
        error: "This reservation has already started or completed and can no longer be cancelled.",
      }, 400);
    }

    const reservedAt = new Date(reservation.reserved_at);
    if (Number.isNaN(reservedAt.getTime())) {
      return json({ error: "Reservation date is invalid" }, 400);
    }
    if (reservedAt.getTime() < Date.now()) {
      return json({ error: "Past reservations cannot be cancelled" }, 400);
    }

    // All cancels fully refund — the 24h cliff was removed 2026-05-15.
    // Both diner-initiated and owner-initiated cancels run the refund
    // block below; the only branch is on cancellation_reason wording.

    const { data: restaurant } = await adminClient
      .from("restaurants")
      .select("name, timezone")
      .eq("id", reservation.restaurant_id)
      .maybeSingle<RestaurantRow>();
    const restaurantName =
      typeof restaurant?.name === "string" && restaurant.name.trim()
        ? restaurant.name.trim()
        : "the restaurant";
    const guestName =
      reservation.guest_full_name?.trim() ||
      guest?.full_name?.trim() ||
      "there";
    const guestEmail = reservation.guest_email?.trim() || guest?.email?.trim() || null;
    const guestPhone = reservation.guest_phone?.trim() || guest?.phone?.trim() || null;
    const dateLabel = formatReservationDate(
      reservedAt,
      restaurant?.timezone?.trim() || "America/Toronto",
    );
    const codeLine = reservation.confirmation_code?.trim()
      ? ` Confirmation code: ${reservation.confirmation_code.trim()}.`
      : "";

    // Surface the event / promotion the reservation is linked to in the SMS
    // body so the diner immediately recognises which booking was cancelled.
    let eventLine = "";
    let promoLine = "";
    if (reservation.event_id) {
      const { data: ev } = await adminClient
        .from("events")
        .select("name")
        .eq("id", reservation.event_id)
        .maybeSingle<{ name: string | null }>();
      if (ev?.name) eventLine = ` Event: ${ev.name}.`;
    }
    if (reservation.promotion_id) {
      const { data: pr } = await adminClient
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

    // 2026-05-27: notification body is built AFTER the refund phase so we
    // can include the refund total + preorder items the diner had. The
    // helper itself tolerates a null guestId — only the communication_log
    // audit insert is skipped when there's no linked guests row.
    // Look up preorder items up-front (orders + order_items rows survive
    // the cancel — we flip the order status but don't delete the rows).
    const { data: cancelOrderRow } = await adminClient
      .from("orders")
      .select("id, order_items(name, quantity)")
      .eq("reservation_id", reservationId)
      .eq("is_preorder", true)
      .maybeSingle();
    const cancelPreorderItems =
      cancelOrderRow && Array.isArray((cancelOrderRow as { order_items?: unknown }).order_items)
        ? ((cancelOrderRow as { order_items: Array<{ name?: unknown; quantity?: unknown }> }).order_items)
          .map((it) => ({
            name: typeof it.name === "string" ? it.name : "",
            quantity: typeof it.quantity === "number" ? it.quantity : Number(it.quantity ?? 1),
          }))
          .filter((it) => it.name && Number.isFinite(it.quantity) && it.quantity > 0)
        : [];

    const sendCancellationNotice = async () => {
      const opener =
        actor === "owner"
          ? `Hi ${guestName}, ${restaurantName} had to cancel your reservation for ${reservation.party_size} ` +
            `${reservation.party_size === 1 ? "guest" : "guests"} on ${dateLabel}. Apologies for the inconvenience — please reach out to rebook.`
          : `Hi ${guestName}, your reservation at ${restaurantName} for ${reservation.party_size} ` +
            `${reservation.party_size === 1 ? "guest" : "guests"} on ${dateLabel} has been cancelled.`;
      const subject =
        actor === "owner"
          ? `${restaurantName} cancelled your reservation`
          : `Your reservation at ${restaurantName} was cancelled`;

      // Refund summary: split between successful preorder and deposit refunds
      // so the diner sees both lines when both apply.
      const successfulRefunds = refundOutcomes.filter((r) => r.ok);
      const depositRefundCents = successfulRefunds
        .filter((r) => r.kind === "deposit")
        .reduce((sum, r) => sum + r.amount_cents, 0);
      const preorderRefundCents = successfulRefunds
        .filter((r) => r.kind === "preorder")
        .reduce((sum, r) => sum + r.amount_cents, 0);
      // 2026-05-28 (PR-K): when the deposit was split-tender, the body
      // breaks down per-payer so each diner sees their own refund line.
      // Solo bookings keep the original single-line shape.
      const depositRefunds = successfulRefunds.filter((r) => r.kind === "deposit");
      const isSplitDeposit = depositRefunds.length >= 2;
      const splitDepositLines = isSplitDeposit
        ? depositRefunds
            .map((r) => {
              const name = (r.payer_full_name ?? "").trim() || "Co-payer";
              return `  • ${name}: ${formatCents(r.amount_cents)}`;
            })
            .join("\n")
        : "";

      let refundLine = "";
      if (depositRefundCents > 0 && preorderRefundCents > 0) {
        refundLine =
          `\nRefunded: ${formatCents(depositRefundCents + preorderRefundCents)}` +
          ` (deposit ${formatCents(depositRefundCents)}` +
          ` + pre-order ${formatCents(preorderRefundCents)}).` +
          (isSplitDeposit
            ? `\nDeposit split across ${depositRefunds.length} cards:\n${splitDepositLines}`
            : "") +
          `\nRefunds typically appear within 5–10 business days.`;
      } else if (depositRefundCents > 0) {
        refundLine = isSplitDeposit
          ? `\nDeposit refunded across ${depositRefunds.length} cards (total ${formatCents(depositRefundCents)}):\n${splitDepositLines}` +
            `\nRefunds typically appear within 5–10 business days.`
          : `\nDeposit refunded: ${formatCents(depositRefundCents)} to your card.` +
            ` Refunds typically appear within 5–10 business days.`;
      } else if (preorderRefundCents > 0) {
        refundLine =
          `\nPre-order refunded: ${formatCents(preorderRefundCents)} to your card.` +
          ` Refunds typically appear within 5–10 business days.`;
      }

      const preorderLine = cancelPreorderItems.length > 0
        ? `\nPre-ordered items: ${cancelPreorderItems.map((it) => `${it.quantity}× ${it.name}`).join(", ")}`
        : "";

      return await sendReservationNotification({
        supabase: adminClient,
        guestId: guest?.id ?? reservation.guest_id ?? null,
        restaurantId: reservation.restaurant_id,
        reservationId,
        type: "reservation_cancellation",
        email: guestEmail,
        phone: guestPhone,
        subject,
        body: opener + codeLine + eventLine + promoLine + preorderLine + refundLine,
      });
    };

    const cancellationReason =
      actor === "owner" ? "Cancelled by restaurant" : "Cancelled by diner";
    const { error: updateError } = await adminClient
      .from("reservations")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancellation_reason: cancellationReason,
      })
      .eq("id", reservationId);
    if (updateError) return json({ error: updateError.message }, 400);

    // ─── Refund phase ───────────────────────────────────────────────────
    // After the reservation flips to 'cancelled', refund any paid pre-order
    // and any charged deposits attached to this reservation. The 24h cliff
    // was removed 2026-05-15 — every cancel now refunds in full, regardless
    // of how close to the reservation time and regardless of who initiated.
    //
    // Idempotency: the status filters ('paid' for orders, 'charged' for
    // deposits) plus the helper's `charge_already_refunded` backstop mean a
    // retried cancel won't double-refund. Failed refunds NEVER block the
    // cancel response — the outcomes list tells the client which refunds
    // went through so the UI can toast accordingly.
    //
    // Stub-mode deposits: when DEPOSIT_STRIPE_STUB_MODE=true,
    // confirm-deposit-stub flips status='charged' without minting a real PI,
    // so stripe_payment_intent_id is null. We still want the UI to show
    // "Refunded" — flip those rows to 'refunded' in DB without a Stripe call.
    const refundOutcomes: RefundOutcomeReport[] = [];
    const refundedDepositPayerIds: string[] = [];

    // Stub-deposit DB-only sweep: must run BEFORE the PI-based loop so the
    // status='charged' filter on the real-PI query doesn't pick them back up.
    const { data: stubDeposits } = await adminClient
      .from("reservation_deposit_payments")
      .select("id, amount_cents, payer_full_name, payer_email")
      .eq("reservation_id", reservationId)
      .eq("status", "charged")
      .is("stripe_payment_intent_id", null);
    if (stubDeposits && stubDeposits.length > 0) {
      await adminClient
        .from("reservation_deposit_payments")
        .update({ status: "refunded" })
        .eq("reservation_id", reservationId)
        .eq("status", "charged")
        .is("stripe_payment_intent_id", null);
      for (const dep of stubDeposits) {
        const row = dep as {
          id: string;
          amount_cents: number | null;
          payer_full_name: string | null;
          payer_email: string | null;
        };
        refundOutcomes.push({
          kind: "deposit",
          ok: true,
          payment_intent_id: null,
          amount_cents: row.amount_cents ?? 0,
          payer_full_name: row.payer_full_name,
          payer_email: row.payer_email,
        });
        refundedDepositPayerIds.push(row.id);
      }
    }

    // No-PI orders silent sweep: legacy/comped orders sometimes landed in
    // 'paid' status without a Stripe PI on the row (mark-order-paid wasn't
    // enforced in older flows). Without this, the order stays 'paid' after
    // cancel — confusing UX (the diner sees "Paid" on a cancelled booking).
    // Flip them to 'refunded' in DB so the UI shows "Refunded", but DO NOT
    // add to refundOutcomes — no real money moved, so the toast shouldn't
    // claim a refund. The diner just gets "Reservation cancelled."
    await adminClient
      .from("orders")
      .update({ status: "refunded" })
      .eq("reservation_id", reservationId)
      .eq("status", "paid")
      .is("stripe_payment_intent_id", null);

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (stripeKey) {
      const stripe = await getStripeClient(stripeKey);

      // Track PIs already refunded by the pre-order loop. Combined
      // pre-order + deposit bookings share ONE PaymentIntent and store the
      // FULL base (preorder + tax + deposit) on orders.total_amount, so the
      // order refund below returns everything in one go. A subsequent deposit
      // refund on the same PI would exceed its remaining refundable amount and
      // error out, leaving the RDP row stuck at 'charged'. We use this set to
      // reconcile such deposit rows to 'refunded' without a second Stripe call.
      const refundedViaOrderPiIds = new Set<string>();

      // Pre-order refunds. orders.total_amount is a numeric dollar value,
      // not cents — convert at report time.
      const { data: paidOrders } = await adminClient
        .from("orders")
        .select("id, stripe_payment_intent_id, total_amount")
        .eq("reservation_id", reservationId)
        .eq("status", "paid")
        .not("stripe_payment_intent_id", "is", null);
      for (const order of paidOrders ?? []) {
        const row = order as {
          id: string;
          stripe_payment_intent_id: string | null;
          total_amount: number | string | null;
        };
        const piId = row.stripe_payment_intent_id;
        const amountCents = Math.round(Number(row.total_amount ?? 0) * 100);
        if (!piId) continue;
        // Break-even policy — see _shared/refund-math.ts.
        const { refundCents } = computeBreakEvenRefund(amountCents);
        const outcome = await refundPaymentIntent(
          stripe,
          piId,
          "reservation_cancelled",
          refundCents > 0 ? refundCents : undefined,
        );
        if (outcome.ok) {
          refundedViaOrderPiIds.add(piId);
          await adminClient
            .from("orders")
            .update({ status: "refunded" })
            .eq("id", row.id);
          refundOutcomes.push({
            kind: "preorder",
            ok: true,
            payment_intent_id: piId,
            amount_cents: refundCents > 0 ? refundCents : amountCents,
          });
        } else {
          refundOutcomes.push({
            kind: "preorder",
            ok: false,
            payment_intent_id: piId,
            amount_cents: refundCents > 0 ? refundCents : amountCents,
            error: outcome.error,
          });
          console.warn(
            `[cancel-reservation] preorder refund failed for order ${row.id}:`,
            outcome.error,
          );
        }
      }

      // Deposit refunds backed by a real Stripe PI.
      const { data: chargedDeposits } = await adminClient
        .from("reservation_deposit_payments")
        .select("id, stripe_payment_intent_id, amount_cents, payer_full_name, payer_email")
        .eq("reservation_id", reservationId)
        .eq("status", "charged")
        .not("stripe_payment_intent_id", "is", null);
      for (const dep of chargedDeposits ?? []) {
        const row = dep as {
          id: string;
          stripe_payment_intent_id: string | null;
          amount_cents: number | null;
          payer_full_name: string | null;
          payer_email: string | null;
        };
        const piId = row.stripe_payment_intent_id;
        const amountCents = row.amount_cents ?? 0;
        if (!piId) continue;
        // Combined preorder+deposit booking: this deposit shares its PI with
        // an order that the loop above already fully refunded (the order's
        // total_amount includes the deposit, so its refund returned the whole
        // base). Re-refunding here would exceed the PI's remaining amount and
        // error out, leaving the row stuck at 'charged'. Reconcile the row to
        // 'refunded' without a second Stripe call. (2026-05-28 fix.)
        if (refundedViaOrderPiIds.has(piId)) {
          await adminClient
            .from("reservation_deposit_payments")
            .update({ status: "refunded" })
            .eq("id", row.id);
          continue;
        }
        // Break-even policy — see _shared/refund-math.ts.
        const { refundCents } = computeBreakEvenRefund(amountCents);
        const outcome = await refundPaymentIntent(
          stripe,
          piId,
          "reservation_cancelled",
          refundCents > 0 ? refundCents : undefined,
        );
        if (outcome.ok) {
          await adminClient
            .from("reservation_deposit_payments")
            .update({ status: "refunded" })
            .eq("id", row.id);
          refundOutcomes.push({
            kind: "deposit",
            ok: true,
            payment_intent_id: piId,
            amount_cents: refundCents > 0 ? refundCents : amountCents,
            payer_full_name: row.payer_full_name,
            payer_email: row.payer_email,
          });
          refundedDepositPayerIds.push(row.id);
        } else {
          refundOutcomes.push({
            kind: "deposit",
            ok: false,
            payment_intent_id: piId,
            amount_cents: refundCents > 0 ? refundCents : amountCents,
            error: outcome.error,
            payer_full_name: row.payer_full_name,
            payer_email: row.payer_email,
          });
          console.warn(
            `[cancel-reservation] deposit refund failed for payment ${row.id}:`,
            outcome.error,
          );
        }
      }
    }

    // Close out any 'pending' deposit payer rows on this reservation
    // (split-deposit co-payers who never paid). Without this they sit
    // as zombies forever — and if a friend later clicks their unpaid
    // link they'd land on a checkout for a cancelled reservation.
    // No money moved, no Stripe call needed.
    await adminClient
      .from("reservation_deposit_payments")
      .update({ status: "cancelled" })
      .eq("reservation_id", reservationId)
      .eq("status", "pending");

    // Notify non-organizer payers (friends who chipped in on a split
    // deposit) that their share was refunded. Fire-and-forget; never
    // blocks the cancel response. Skipped when no deposit payers got
    // refunded — most cancels have no split deposit at all.
    if (refundedDepositPayerIds.length > 0) {
      const notifyUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/notify-deposit-payers-refunded`;
      const notifyPromise = fetch(notifyUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
        },
        body: JSON.stringify({
          reservation_id: reservationId,
          refunded_payer_ids: refundedDepositPayerIds,
        }),
      }).catch((err) => {
        console.warn("[cancel-reservation] notify-deposit-payers-refunded dispatch failed:", err);
      });
      const edge = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
        .EdgeRuntime;
      if (edge?.waitUntil) edge.waitUntil(notifyPromise);
    }

    const refundTotalCents = refundOutcomes
      .filter((r) => r.ok)
      .reduce((sum, r) => sum + r.amount_cents, 0);

    // Notify Me fan-out: when a slot frees up we ping any active
    // `availability_alerts` rows that match this restaurant + date + party.
    // Both the in-app notification (created inside the match RPC) AND a
    // best-effort SMS (via sendNotifyMeSms) get dispatched. Wrapped in
    // try/catch so any fan-out failure can NEVER block the cancel
    // response. RPC is a no-op when zero alerts match.
    const fanOutSlotOpened = async () => {
      try {
        const rows: FulfilledAlertRow[] = [];
        const { data: restRows, error: restErr } = await adminClient.rpc(
          "match_availability_alerts_for_restaurant",
          {
            p_restaurant_id: reservation.restaurant_id,
            p_freed_at: reservation.reserved_at,
            p_freed_party_size: reservation.party_size,
          },
        );
        if (!restErr && restRows) rows.push(...(restRows as FulfilledAlertRow[]));
        if (reservation.event_id) {
          const { data: evtRows, error: evtErr } = await adminClient.rpc(
            "match_availability_alerts_for_event",
            { p_event_id: reservation.event_id },
          );
          if (!evtErr && evtRows) rows.push(...(evtRows as FulfilledAlertRow[]));
        }
        if (rows.length > 0) {
          // Fire-and-forget the SMS dispatch so Twilio latency never blocks
          // the cancel response. waitUntil keeps the promise alive after
          // the function returns. Falls back to a plain promise if the
          // runtime doesn't expose waitUntil (local Deno).
          const dispatch = sendNotifyMeSms(adminClient, rows).catch((e) =>
            console.warn("[cancel-reservation] notify-me SMS dispatch failed:", e),
          );
          const edge = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
            .EdgeRuntime;
          if (edge?.waitUntil) edge.waitUntil(dispatch);
        }
      } catch (e) {
        // Swallow — alert fan-out must never block cancel.
        console.warn("[cancel-reservation] notify-me fan-out failed:", e);
      }
    };

    // 2026-05-28 (PR-K): per-payer breakdown for owner email body.
    // Surfaces a bullet list of {payer name, amount, status} when the
    // reservation was split-tender. Solo bookings render a single line.
    const refundBreakdown = refundOutcomes
      .filter((r) => r.kind === "deposit")
      .map((r) => ({
        payer_full_name: r.payer_full_name ?? null,
        payer_email: r.payer_email ?? null,
        amount_cents: r.amount_cents,
        payment_intent_id: r.payment_intent_id,
        ok: r.ok,
      }));

    // Owner cancellation notification (fire-and-forget). Honors the
    // owner's notification_preferences_json.cancellation_email toggle
    // internally. Goes to the owner's user_profile.email, never
    // restaurants.email (the shared inbox).
    const fireOwnerCancelNotify = () => {
      void notifyOwnerCancellation({
        supabase: adminClient,
        restaurant_id: reservation.restaurant_id,
        reservation_id: reservationId,
        reserved_at: reservation.reserved_at,
        party_size: reservation.party_size,
        guest_full_name:
          reservation.guest_full_name ?? guest?.full_name ?? null,
        confirmation_code: reservation.confirmation_code ?? null,
        actor,
        refund_breakdown: refundBreakdown,
      }).catch((err) => {
        console.error("[cancel-reservation] notifyOwnerCancellation failed", err);
      });
    };

    const { error: rpcReleaseError } = await adminClient.rpc("release_reservation_tables", {
      p_reservation_id: reservationId,
    });
    if (!rpcReleaseError) {
      await fanOutSlotOpened();
      const notification = await sendCancellationNotice();
      fireOwnerCancelNotify();
      return json({
        ok: true,
        reservation_id: reservationId,
        status: "cancelled",
        notification_delivery: notification.status,
        notification_delivery_channel: notification.channel,
        refunds: refundOutcomes,
        refund_total_cents: refundTotalCents,
        actor,
      });
    }

    const { data: assignedTables, error: assignedTablesError } = await adminClient
      .from("reservation_tables")
      .select("table_id")
      .eq("reservation_id", reservationId)
      .is("released_at", null)
      .returns<ReservationTableRow[]>();
    if (assignedTablesError && assignedTablesError.code !== "42P01") {
      return json({ error: assignedTablesError.message }, 400);
    }

    const tableIds = Array.from(
      new Set([
        ...((assignedTables ?? []).map((row) => row.table_id)),
        ...(reservation.table_id ? [reservation.table_id] : []),
      ]),
    );

    const { error: linkReleaseError } = await adminClient
      .from("reservation_tables")
      .update({ released_at: new Date().toISOString() })
      .eq("reservation_id", reservationId)
      .is("released_at", null);
    if (linkReleaseError && linkReleaseError.code !== "42P01") {
      return json({ error: linkReleaseError.message }, 400);
    }

    if (tableIds.length > 0) {
      const { error: tableUpdateError } = await adminClient
        .from("tables")
        .update({
          status: "empty",
          seated_count: 0,
          combined_with: null,
          updated_at: new Date().toISOString(),
        })
        .in("id", tableIds)
        .neq("status", "blocked");
      if (tableUpdateError) return json({ error: tableUpdateError.message }, 400);
    }

    await fanOutSlotOpened();
    const notification = await sendCancellationNotice();
    fireOwnerCancelNotify();
    return json({
      ok: true,
      reservation_id: reservationId,
      status: "cancelled",
      notification_delivery: notification.status,
      notification_delivery_channel: notification.channel,
      refunds: refundOutcomes,
      refund_total_cents: refundTotalCents,
      actor,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
