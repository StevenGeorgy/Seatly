// confirm-deposit-paid: Flips a reservation_deposit_payments row from
// 'pending' to 'charged' after the frontend confirms a Stripe
// PaymentIntent has succeeded. Required because reservation_deposit_payments
// RLS only permits service-role + staff UPDATEs — diners cannot mark their
// own deposit charged client-side (an earlier flow tried this and silently
// failed for non-staff diners).
//
// We re-verify the PaymentIntent state with Stripe before trusting the
// transition, AND check the PI amount covers the deposit, so a malicious
// client can't flip an unpaid deposit to charged by guessing IDs.
//
// Once the row is 'charged', the existing settle trigger flips the parent
// reservation from 'pending_payment' to 'confirmed' (when all the
// reservation's deposit rows are charged — supports future multi-payer
// splits).
//
// Anon-callable. The diner may not have an account.
//
// Body: { payment_id: string, payment_intent_id: string }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { enforceRateLimit, rateLimitIdentifier, RateLimitError } from "../_shared/rate-limit.ts";
import { parseJsonBody } from "../_shared/validation/parse.ts";
import { ConfirmDepositPaidSchema } from "../_shared/validation/payment.ts";
import { getStripeClient } from "../_shared/stripe-client.ts";
import { refundPaymentIntent } from "../_shared/stripe-refund.ts";
import {
  buildConfirmationBody,
  formatReservationDate,
  sendReservationNotification,
} from "../_shared/reservation-notifications.ts";
import { notifyOwnerNewReservation } from "../_shared/owner-notifications.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Payload = {
  payment_id?: unknown;
  payment_intent_id?: unknown;
};

type DepositRow = {
  id: string;
  reservation_id: string;
  amount_cents: number;
  status: string;
  stripe_payment_intent_id: string | null;
};

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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
        "confirm-deposit-paid",
        rateLimitIdentifier(req),
        { limit: 60, windowSeconds: 60 },
      );
    } catch (err) {
      if (err instanceof RateLimitError) return jsonRes({ error: err.message }, 429);
      throw err;
    }

    const parsed = await parseJsonBody(req, ConfirmDepositPaidSchema, {
      jsonRes: (b, s) => jsonRes(b, s),
    });
    if ("response" in parsed) return parsed.response;
    const paymentId = parsed.data.payment_id;
    const paymentIntentId = parsed.data.payment_intent_id;
    if (!paymentIntentId.startsWith("pi_")) {
      return jsonRes({ error: "Invalid payment_intent_id format" }, 400);
    }

    // Load the deposit row to verify the requested amount lines up with the
    // PaymentIntent. Without this an attacker who knows a payment_id could
    // associate it with an unrelated low-value PI (e.g. their own $1 charge
    // somewhere else) and fraudulently mark the deposit charged.
    const { data: depositRowRaw, error: depErr } = await supabaseAdmin
      .from("reservation_deposit_payments")
      .select("id, reservation_id, amount_cents, status, stripe_payment_intent_id")
      .eq("id", paymentId)
      .maybeSingle();
    if (depErr) return jsonRes({ error: depErr.message }, 400);
    const depositRow = depositRowRaw as DepositRow | null;
    if (!depositRow) return jsonRes({ error: "Deposit payment not found" }, 404);

    // Idempotent: if already charged with the SAME PI, return success.
    if (
      depositRow.status === "charged" &&
      depositRow.stripe_payment_intent_id === paymentIntentId
    ) {
      return jsonRes({ deposit: depositRow, idempotent: true });
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) return jsonRes({ error: "Stripe is not configured on the server" }, 500);

    const stripe = await getStripeClient(stripeKey);

    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (intent.status !== "succeeded" && intent.status !== "processing") {
      return jsonRes(
        { error: `PaymentIntent not paid (status: ${intent.status})` },
        400,
      );
    }

    // The PI may be larger than the deposit when it bundles a pre-order
    // (totalNow = food + deposit). Only require >= deposit, not exact match.
    if ((intent.amount ?? 0) < depositRow.amount_cents) {
      return jsonRes(
        {
          error: `PaymentIntent amount (${intent.amount}¢) is less than deposit (${depositRow.amount_cents}¢)`,
        },
        400,
      );
    }

    // ── Security check: PI must have been created for THIS restaurant.
    // Without this, an attacker who knows a deposit's `payment_id` could
    // submit any unrelated succeeded PI of sufficient amount (e.g. their
    // own charge on another platform) and have us flip the deposit to
    // 'charged'. Verifying restaurant_id (stamped on PI creation) +
    // transfer_data.destination (the Connect routing target) closes the
    // attack: only PIs that were legitimately created via
    // create-public-payment-intent for the same restaurant pass.
    // Audit finding 2026-05-20 (Vuln 2).
    const { data: linkedReservation } = await supabaseAdmin
      .from("reservations")
      .select("restaurant_id, restaurants:restaurants(stripe_account_id)")
      .eq("id", depositRow.reservation_id)
      .maybeSingle();
    const linkedRow = linkedReservation as
      | { restaurant_id: string | null; restaurants: { stripe_account_id: string | null } | null }
      | null;
    const expectedRestaurantId = linkedRow?.restaurant_id ?? null;
    const expectedDestination = linkedRow?.restaurants?.stripe_account_id ?? null;
    const piRestaurantId = typeof intent.metadata?.restaurant_id === "string"
      ? intent.metadata.restaurant_id
      : null;
    if (!expectedRestaurantId || piRestaurantId !== expectedRestaurantId) {
      return jsonRes({ error: "pi_restaurant_mismatch" }, 400);
    }
    // Destination check only fires when the restaurant has Stripe-Connect-
    // routed payments configured. Pre-Connect bookings (legacy) or platform-
    // direct charges won't have a destination — skip the check in that case
    // rather than reject. The restaurant_id check above is the primary gate.
    const piDestination = (intent as { transfer_data?: { destination?: string | null } | null })
      ?.transfer_data?.destination ?? null;
    if (expectedDestination && piDestination && piDestination !== expectedDestination) {
      return jsonRes({ error: "pi_destination_mismatch" }, 400);
    }

    // Tightest check (Vuln 2 full hardening, 2026-05-20): PI's metadata
    // must list THIS deposit row. The producer (create-public-payment-intent)
    // stamps `metadata.deposit_payment_ids` at create time as a comma-joined
    // UUID list. Without this check, even with the restaurant_id +
    // destination guards above, an attacker could swap PIs between deposits
    // within the same restaurant (e.g. claim a friend's $5 PI to settle
    // their own $100 deposit). Strict from day 1 — no legacy fallback.
    const stampedRaw = typeof intent.metadata?.deposit_payment_ids === "string"
      ? intent.metadata.deposit_payment_ids
      : "";
    const stamped = stampedRaw.split(",").map((s) => s.trim()).filter(Boolean);
    if (!stamped.includes(paymentId)) {
      return jsonRes({ error: "pi_payment_id_mismatch" }, 400);
    }

    // 2026-05-28 orphan-refund guard: a slow diner can sit on the cart
    // > 30 min, get their pending_payment reservation auto-cancelled by
    // sweep_abandoned_split_tender_reservations (added 2026-05-28), then
    // finally click Place Order using the client's cached reservation_id.
    // Stripe charges. Without this guard, the RDP would flip to charged
    // on a parent that's already 'cancelled' — money on the connected
    // account with no booking. The settle trigger's cancelled guard
    // (added 2026-05-28) prevents the DB mismatch, but the money still
    // sits in the wrong place.
    //
    // Detection + recovery: fetch the parent's current status here
    // (after all security checks). If the parent is in any terminal
    // state, refund the PI in full (reverse_transfer=true puts the
    // money back where it came from), mark the RDP as refunded, and
    // return a non-error response so the client doesn't retry.
    //
    // The diner receives Stripe's standard refund email; we deliberately
    // do NOT send a Seatly-side email because the diner never received a
    // booking confirmation in the first place (split-tender's
    // reservation_confirmation only fires post-settle, which never
    // happened on this booking).
    const TERMINAL_STATES = ["cancelled", "no_show", "completed"];
    const { data: parentForOrphanCheck } = await supabaseAdmin
      .from("reservations")
      .select("status")
      .eq("id", depositRow.reservation_id)
      .maybeSingle();
    const currentParentStatus =
      (parentForOrphanCheck as { status?: string } | null)?.status ?? null;
    if (currentParentStatus && TERMINAL_STATES.includes(currentParentStatus)) {
      console.warn(
        "[confirm-deposit-paid] orphan charge detected",
        "reservation=", depositRow.reservation_id,
        "parent_status=", currentParentStatus,
        "pi=", paymentIntentId,
      );
      const refundOutcome = await refundPaymentIntent(
        stripe,
        paymentIntentId,
        "orphan_split_tender_after_sweep",
        // No amountCents → full refund. The reservation is cancelled,
        // not shrunk; the diner gets the entire deposit back.
      );
      if (!refundOutcome.ok) {
        // Refund failed — log loudly so ops can manually intervene.
        // Return the diner an error so they know something went wrong
        // (Stripe's own receipt will still show the charge).
        console.error(
          "[confirm-deposit-paid] orphan refund FAILED — manual intervention required",
          "pi=", paymentIntentId,
          "error=", refundOutcome.error,
        );
        return jsonRes(
          {
            error: "Your card was charged but your reservation was no longer active. Our team has been notified; you'll see the refund within 5-10 business days.",
            orphan: true,
          },
          409,
        );
      }
      // Mark the RDP as refunded so the settle trigger's refunded-branch
      // can do its thing (which is a no-op on a cancelled parent thanks
      // to the cancelled-guard added 2026-05-28 — clean state).
      const nowIso = new Date().toISOString();
      const { data: refundedRow } = await supabaseAdmin
        .from("reservation_deposit_payments")
        .update({
          status: "refunded",
          stripe_payment_intent_id: paymentIntentId,
          paid_at: nowIso,
        })
        .eq("id", paymentId)
        .select("id, reservation_id, status, amount_cents, stripe_payment_intent_id, paid_at")
        .single();
      return jsonRes({
        deposit: refundedRow ?? depositRow,
        orphan_refunded: true,
        parent_status: currentParentStatus,
      });
    }

    const { data, error } = await supabaseAdmin
      .from("reservation_deposit_payments")
      .update({
        status: "charged",
        stripe_payment_intent_id: paymentIntentId,
        paid_at: new Date().toISOString(),
      })
      .eq("id", paymentId)
      .select("id, reservation_id, status, amount_cents, stripe_payment_intent_id, paid_at")
      .single();
    if (error) return jsonRes({ error: error.message }, 400);

    // 2026-05-27: Post-settle confirmation fan-out. The DB settle trigger
    // (migration 20260510000400_deposit_policy.sql:204-257) flips the
    // reservation from `pending_payment` to `confirmed` synchronously on
    // this UPDATE once every row for the reservation is `charged`. So if
    // we re-fetch and see `confirmed`, this was the last pending row.
    //
    // Idempotency: the early-return at lines 102-107 above already covers
    // retries (a second call sees the row already 'charged' and short-
    // circuits before reaching this point). No additional log-lookup
    // guard is needed here.
    //
    // Fan-out: dedupe by lowercased payer_email so today's behavior (all
    // rows seeded with the booker's contact) collapses to ONE email to
    // the booker. When `split_tender_payer_details` is provided at
    // booking time, each row carries a distinct email and the dedupe
    // naturally splits into N sends — one per friend with their share.
    try {
      const { data: reservation } = await supabaseAdmin
        .from("reservations")
        .select(
          "id, status, guest_id, restaurant_id, party_size, reserved_at, confirmation_code, guest_full_name, guest_email, guest_phone",
        )
        .eq("id", depositRow.reservation_id)
        .maybeSingle();

      if (reservation && reservation.status === "confirmed") {
        const { data: restaurant } = await supabaseAdmin
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

        // Preorder items for the body (joined from orders → order_items).
        const { data: orderRow } = await supabaseAdmin
          .from("orders")
          .select("id, order_items(name, quantity)")
          .eq("reservation_id", reservation.id)
          .eq("is_preorder", true)
          .maybeSingle();
        const preorderItems =
          orderRow && Array.isArray((orderRow as { order_items?: unknown }).order_items)
            ? (((orderRow as { order_items: Array<{ name?: unknown; quantity?: unknown }> }).order_items)
              .map((item) => ({
                name: typeof item.name === "string" ? item.name : "",
                quantity: typeof item.quantity === "number" ? item.quantity : Number(item.quantity ?? 1),
              }))
              .filter((item) => item.name && Number.isFinite(item.quantity) && item.quantity > 0))
            : null;

        // Pull every charged row for the reservation so we can dedupe by
        // email and sum each unique payer's totalCents.
        const { data: chargedRows } = await supabaseAdmin
          .from("reservation_deposit_payments")
          .select("payer_email, payer_full_name, amount_cents")
          .eq("reservation_id", reservation.id)
          .eq("status", "charged");

        const organizerEmailLower = reservation.guest_email
          ? reservation.guest_email.trim().toLowerCase()
          : null;
        const organizerPhone = reservation.guest_phone ?? null;
        const organizerName = reservation.guest_full_name?.trim() || "there";

        type PayerEntry = { email: string; name: string; totalCents: number };
        const recipientMap = new Map<string, PayerEntry>();
        for (const row of (chargedRows ?? [])) {
          const rawEmail = typeof row.payer_email === "string" ? row.payer_email.trim() : "";
          if (!rawEmail) continue;
          const key = rawEmail.toLowerCase();
          const entry = recipientMap.get(key);
          const amount = typeof row.amount_cents === "number" ? row.amount_cents : 0;
          if (entry) {
            entry.totalCents += amount;
          } else {
            const name = typeof row.payer_full_name === "string" && row.payer_full_name.trim()
              ? row.payer_full_name.trim()
              : (key === organizerEmailLower ? organizerName : "there");
            recipientMap.set(key, { email: rawEmail, name, totalCents: amount });
          }
        }

        // Fallback: if no charged rows carry an email (shouldn't happen
        // given the deposit-row check constraint, but defensive), send a
        // single confirmation to the organizer using the reservation's
        // own contact + the just-charged row's amount.
        if (recipientMap.size === 0 && organizerEmailLower) {
          recipientMap.set(organizerEmailLower, {
            email: reservation.guest_email!,
            name: organizerName,
            totalCents: data.amount_cents,
          });
        }

        for (const entry of recipientMap.values()) {
          const isOrganizer = organizerEmailLower !== null
            && entry.email.toLowerCase() === organizerEmailLower;
          const manageLink = isOrganizer && restaurantSlug && reservation.confirmation_code
            ? `https://cenaiva.com/${restaurantSlug}?confirmation=${encodeURIComponent(reservation.confirmation_code)}${reservation.guest_email ? `&email=${encodeURIComponent(reservation.guest_email)}` : ""}`
            : null;
          const body = buildConfirmationBody({
            guestName: entry.name,
            restaurantName,
            partySize: reservation.party_size,
            reservationDateLabel,
            confirmationCode: reservation.confirmation_code ?? "",
            manageLink,
            restaurantPhone,
            preorderItems: isOrganizer ? preorderItems : null,
            depositPaidCents: entry.totalCents,
          });
          await sendReservationNotification({
            supabase: supabaseAdmin,
            guestId: reservation.guest_id,
            restaurantId: reservation.restaurant_id,
            reservationId: reservation.id,
            type: "reservation_confirmation",
            email: entry.email,
            phone: isOrganizer ? organizerPhone : null,
            subject: `Your reservation at ${restaurantName} is confirmed`,
            body,
          });
        }

        // 2026-05-28 split-tender owner notification. For split-tender
        // bookings, create-public-booking deliberately SKIPS the owner
        // notification on creation (the reservation is still in
        // pending_payment and may never actually be paid). The settle-
        // trigger only flips status to 'confirmed' after the last RDP
        // charges — and we just observed that status here. So this is
        // the single right moment to notify the owner that they have a
        // real, paid split-tender booking.
        //
        // Idempotency: the early-return at lines 102-107 in this fn covers
        // retries. notifyOwnerNewReservation also has its own preference
        // gate (notification_preferences_json.new_reservation_email) and
        // de-dupes via restaurant_notification_log so multi-fire is safe.
        void notifyOwnerNewReservation({
          supabase: supabaseAdmin,
          restaurant_id: reservation.restaurant_id,
          reservation_id: reservation.id,
          reserved_at: reservation.reserved_at,
          party_size: reservation.party_size,
          guest_full_name: reservation.guest_full_name ?? null,
          confirmation_code: reservation.confirmation_code ?? null,
        }).catch((err) => {
          console.error("[confirm-deposit-paid] notifyOwnerNewReservation failed", err);
        });
      }
    } catch (notifyErr) {
      // Post-settle notification failure must NOT roll back the deposit
      // settlement. The deposit is paid; we just log and continue.
      console.error(
        "[confirm-deposit-paid] post-settle notification failed:",
        notifyErr,
      );
    }

    return jsonRes({ deposit: data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonRes({ error: msg }, 500);
  }
});
