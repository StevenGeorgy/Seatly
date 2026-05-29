// @ts-nocheck
// refund-deposit-on-arrival: idempotent refund of charged deposit rows for a
// single reservation. Called from two places:
//   1. Frontend after the owner clicks Seated (or "Mark as arrived" undo on a
//      no-show row). Auth: Bearer JWT for an owner/manager/host/server/staff
//      role on the reservation's restaurant.
//   2. The auto-complete-stale-reservations cron, after it flips a stale
//      pending/confirmed reservation to 'completed'. Auth: x-cron-secret
//      header matching CRON_SECRET env.
//
// Mutually exclusive: if both headers are present we prefer the cron secret
// and skip the JWT/role check entirely. Hard fail if neither is valid.
//
// Idempotency: already-'refunded' rows are reported as `already_refunded`
// and skipped. Stub rows (status='charged' AND stripe_payment_intent_id IS
// NULL) flip in DB only — no Stripe call.
//
// Refund policy (Option B — see STRIPE_UPDATES.md): refund = base. Both
// the Cenaiva 5.5% platform fee and the Stripe processing fee are
// disclosed to the diner as separate line items at checkout and are
// NON-refundable. Restaurant nets $0 on refunds (received `base` at
// charge, refunds `base` on Seated/Cancel). Centralized in
// _shared/refund-math.ts — see computeBreakEvenRefund().
//
// Failed refunds NEVER block the response — they're reported in `outcomes`
// and the row stays 'charged' for manual operator follow-up.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { buildCorsHeaders } from "../_shared/cors.ts";
import { refundPaymentIntent } from "../_shared/stripe-refund.ts";
import { computeBreakEvenRefund } from "../_shared/refund-math.ts";
import { parseJsonBody } from "../_shared/validation/parse.ts";
import { RefundDepositOnArrivalSchema } from "../_shared/validation/deposit.ts";
import { getStripeClient } from "../_shared/stripe-client.ts";

type OutcomeStatus = "refunded" | "already_refunded" | "failed" | "stub_refunded";

type RefundOutcome = {
  payment_id: string;
  status: OutcomeStatus;
  amount_cents?: number;
  payment_intent_id?: string | null;
  error?: string;
};

type DepositRow = {
  id: string;
  stripe_payment_intent_id: string | null;
  amount_cents: number | null;
  status: string | null;
  payer_user_profile_id?: string | null;
  payer_email?: string | null;
};

type ReservationRow = {
  id: string;
  restaurant_id: string;
  status: string | null;
};

function jsonRes(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...buildCorsHeaders(req), "Content-Type": "application/json" },
  });
}

function cronHeaderPresent(req: Request): boolean {
  return (req.headers.get("x-cron-secret") ?? "").length > 0;
}

function cronHeaderValid(req: Request): boolean {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret) return false;
  return req.headers.get("x-cron-secret") === secret;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: buildCorsHeaders(req) });
  }
  if (req.method !== "POST") {
    return jsonRes(req, { error: "Method not allowed" }, 405);
  }

  try {
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const parsed = await parseJsonBody(req, RefundDepositOnArrivalSchema, {
      jsonRes: (b, s) => jsonRes(req, b, s),
    });
    if ("response" in parsed) return parsed.response;
    const reservationId = parsed.data.reservation_id;

    const { data: reservation, error: reservationErr } = await adminClient
      .from("reservations")
      .select("id, restaurant_id, status")
      .eq("id", reservationId)
      .maybeSingle<ReservationRow>();
    if (reservationErr) return jsonRes(req, { error: reservationErr.message }, 400);
    if (!reservation) return jsonRes(req, { error: "Reservation not found" }, 404);

    // Auth gate — cron takes precedence if both headers are present.
    const authHeader = req.headers.get("Authorization") ?? "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

    if (cronHeaderPresent(req)) {
      if (!cronHeaderValid(req)) {
        return jsonRes(req, { error: "unauthorized" }, 401);
      }
      // Cron path is privileged — no restaurant scope check.
    } else if (bearerToken) {
      const { data: { user }, error: userErr } = await adminClient.auth.getUser(bearerToken);
      if (userErr || !user) return jsonRes(req, { error: "Invalid or expired session" }, 401);

      const { data: profile, error: profileErr } = await adminClient
        .from("user_profiles")
        .select("id")
        .eq("auth_user_id", user.id)
        .maybeSingle<{ id: string }>();
      if (profileErr) return jsonRes(req, { error: profileErr.message }, 400);
      if (!profile) return jsonRes(req, { error: "User profile not found" }, 403);

      const { data: roleRow, error: roleErr } = await adminClient
        .from("user_restaurant_roles")
        .select("role")
        .eq("user_id", profile.id)
        .eq("restaurant_id", reservation.restaurant_id)
        .in("role", ["owner", "manager", "server", "host", "staff"])
        .maybeSingle<{ role: string }>();
      if (roleErr) return jsonRes(req, { error: roleErr.message }, 400);
      if (!roleRow) {
        return jsonRes(
          req,
          { error: "You don't have permission to refund deposits at this restaurant" },
          403,
        );
      }
    } else {
      return jsonRes(req, { error: "Authentication required" }, 401);
    }

    // Pull every charged or already-refunded row so the response can report
    // both. Failed/pending/cancelled rows aren't refundable — skip them
    // entirely by filtering server-side.
    const { data: depositsRaw, error: depositsErr } = await adminClient
      .from("reservation_deposit_payments")
      .select("id, stripe_payment_intent_id, amount_cents, status, payer_user_profile_id, payer_email")
      .eq("reservation_id", reservationId)
      .in("status", ["charged", "refunded"]);
    if (depositsErr) return jsonRes(req, { error: depositsErr.message }, 400);

    const deposits = (depositsRaw ?? []) as DepositRow[];
    const outcomes: RefundOutcome[] = [];
    const refundedPayerIds: string[] = [];
    const payerUserProfileIds = new Set<string>();
    const payerEmails = new Set<string>();

    if (deposits.length === 0) {
      return jsonRes(req, { ok: true, refunded_count: 0, outcomes });
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    // Lazily construct the Stripe client only if at least one row needs it.
    // Stub-only reservations should still complete cleanly with no Stripe
    // key configured (test/sandbox environments).
    let stripe: import("npm:stripe@17").default | null = null;
    const ensureStripe = async () => {
      if (stripe) return stripe;
      if (!stripeKey) return null;
      stripe = await getStripeClient(stripeKey);
      return stripe;
    };

    for (const row of deposits) {
      // Already refunded — idempotent skip.
      if (row.status === "refunded") {
        outcomes.push({
          payment_id: row.id,
          status: "already_refunded",
          amount_cents: row.amount_cents ?? 0,
          payment_intent_id: row.stripe_payment_intent_id,
        });
        continue;
      }

      // Stub-mode deposit (DEPOSIT_STRIPE_STUB_MODE landed status='charged'
      // with no PI). DB flip only — no Stripe action possible.
      if (!row.stripe_payment_intent_id) {
        const { error: stubErr } = await adminClient
          .from("reservation_deposit_payments")
          .update({ status: "refunded" })
          .eq("id", row.id)
          .eq("status", "charged");
        if (stubErr) {
          outcomes.push({
            payment_id: row.id,
            status: "failed",
            amount_cents: row.amount_cents ?? 0,
            payment_intent_id: null,
            error: stubErr.message,
          });
        } else {
          outcomes.push({
            payment_id: row.id,
            status: "stub_refunded",
            amount_cents: row.amount_cents ?? 0,
            payment_intent_id: null,
          });
          refundedPayerIds.push(row.id);
          if (row.payer_user_profile_id) payerUserProfileIds.add(row.payer_user_profile_id);
          if (row.payer_email) payerEmails.add(row.payer_email);
        }
        continue;
      }

      const piId = row.stripe_payment_intent_id;
      const amountCents = row.amount_cents ?? 0;
      const stripeClient = await ensureStripe();
      if (!stripeClient) {
        outcomes.push({
          payment_id: row.id,
          status: "failed",
          amount_cents: amountCents,
          payment_intent_id: piId,
          error: "STRIPE_SECRET_KEY not configured",
        });
        continue;
      }

      // Standalone break-even policy — see _shared/refund-math.ts.
      const { refundCents } = computeBreakEvenRefund(amountCents);

      // Edge case: refundCents <= 0 means the app fee already ate the whole
      // amount (extreme legacy data or 100% fee). Nothing to refund through
      // Stripe — flip DB to refunded and report as stub.
      if (refundCents === 0) {
        const { error: flipErr } = await adminClient
          .from("reservation_deposit_payments")
          .update({ status: "refunded" })
          .eq("id", row.id)
          .eq("status", "charged");
        if (flipErr) {
          outcomes.push({
            payment_id: row.id,
            status: "failed",
            amount_cents: amountCents,
            payment_intent_id: piId,
            error: flipErr.message,
          });
        } else {
          outcomes.push({
            payment_id: row.id,
            status: "stub_refunded",
            amount_cents: amountCents,
            payment_intent_id: piId,
          });
          refundedPayerIds.push(row.id);
          if (row.payer_user_profile_id) payerUserProfileIds.add(row.payer_user_profile_id);
          if (row.payer_email) payerEmails.add(row.payer_email);
        }
        continue;
      }

      // Always issue a partial refund for refundCents — even when it equals
      // the row amount. Stripe's default (no amount) refunds the FULL pi.amount
      // which would over-refund and bypass Cenaiva's 5.5% cut.
      // Per-row idempotency key: the owner "Seated" click and the
      // auto-complete cron can fire concurrently; the shared key makes Stripe
      // return ONE refund instead of two partial refunds for this row.
      const outcome = await refundPaymentIntent(
        stripeClient,
        piId,
        "deposit_refund_on_arrival",
        refundCents,
        `refund_deposit_${row.id}`,
      );

      if (outcome.ok) {
        const { error: updateErr } = await adminClient
          .from("reservation_deposit_payments")
          .update({ status: "refunded" })
          .eq("id", row.id)
          .eq("status", "charged");
        if (updateErr) {
          // Stripe refund succeeded but DB flip failed — log loudly. The
          // backstop is `charge_already_refunded` on the next call. Treat
          // the outcome as a partial failure so operators can notice.
          console.error(
            `[refund-deposit-on-arrival] Stripe refunded but DB update failed for row ${row.id}:`,
            updateErr.message,
          );
          outcomes.push({
            payment_id: row.id,
            status: "failed",
            amount_cents: refundCents,
            payment_intent_id: piId,
            error: `db_update_failed: ${updateErr.message}`,
          });
          continue;
        }
        outcomes.push({
          payment_id: row.id,
          status: "refunded",
          amount_cents: refundCents,
          payment_intent_id: piId,
        });
        refundedPayerIds.push(row.id);
        if (row.payer_user_profile_id) payerUserProfileIds.add(row.payer_user_profile_id);
        if (row.payer_email) payerEmails.add(row.payer_email);
      } else {
        console.warn(
          `[refund-deposit-on-arrival] refund failed for row ${row.id}:`,
          outcome.error,
        );
        outcomes.push({
          payment_id: row.id,
          status: "failed",
          amount_cents: refundCents,
          payment_intent_id: piId,
          error: outcome.error,
        });
      }
    }

    const refundedCount = outcomes.filter(
      (o) => o.status === "refunded" || o.status === "stub_refunded",
    ).length;

    // Fire-and-forget payer notification. Mirrors cancel-reservation's
    // dispatch shape (just `reservation_id` + `refunded_payer_ids`). The
    // downstream fn resolves payer contact info from the row ids itself.
    if (refundedPayerIds.length > 0) {
      const notifyUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/notify-deposit-payers-refunded`;
      const notifyPromise = fetch(notifyUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
        },
        body: JSON.stringify({
          reservation_id: reservationId,
          refunded_payer_ids: refundedPayerIds,
          payer_user_profile_ids: Array.from(payerUserProfileIds),
          payer_emails: Array.from(payerEmails),
        }),
      }).catch((err) => {
        console.warn(
          "[refund-deposit-on-arrival] notify-deposit-payers-refunded dispatch failed:",
          err,
        );
      });
      const edge = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
        .EdgeRuntime;
      if (edge?.waitUntil) edge.waitUntil(notifyPromise);
    }

    return jsonRes(req, {
      ok: true,
      refunded_count: refundedCount,
      outcomes,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[refund-deposit-on-arrival] fatal", msg);
    return jsonRes(req, { error: msg }, 500);
  }
});
