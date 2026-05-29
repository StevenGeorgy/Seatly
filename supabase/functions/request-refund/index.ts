// @ts-nocheck
// request-refund: diner-initiated refund request for a past reservation
// where the auto-refund path didn't apply (e.g. completed reservation,
// duplicate charge, failed transaction the diner thinks they were
// charged for).
//
// Flow:
//   1. Auth: Bearer JWT required (checkAuth verifies signature)
//   2. Resolve user_profiles.id from auth_user_id
//   3. Validate body via RequestRefundSchema (parseJsonBody)
//   4. Rate limit 5/hr per user
//   5. Insert refund_requests row (status='pending')
//   6. If reason_code='duplicate' + payment_intent_id provided →
//      delegate to refund-payment-intent edge fn (service-role
//      bearer). On success, update row to status='auto_resolved'.
//      On failure, leave row in 'pending' for human follow-up.
//   7. Otherwise: email help@cenaiva.com via Resend so an operator
//      can triage manually.
//
// Returns { ok: true, request_id, status }.
//
// Note: verify_jwt = false in config.toml because the Supabase gateway
// doesn't pass ES256 tokens; the in-function checkAuth call IS the
// cryptographic signature check.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Resend } from "npm:resend@4.0.0";

import { checkAuth } from "../_shared/auth.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";
import {
  enforceRateLimit,
  rateLimitIdentifier,
  RateLimitError,
} from "../_shared/rate-limit.ts";
import { parseJsonBody } from "../_shared/validation/parse.ts";
import { RequestRefundSchema } from "../_shared/validation/refund-request.ts";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

function jsonRes(body: unknown, status = 200, req?: Request): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...buildCorsHeaders(req), "Content-Type": "application/json" },
  });
}

async function tryAutoRefund(
  paymentIntentId: string,
): Promise<{ ok: true; refund_id?: string } | { ok: false; error: string }> {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/refund-payment-intent`;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
      },
      body: JSON.stringify({
        payment_intent_id: paymentIntentId,
        reason: "duplicate",
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        error:
          (data && (data.error || data.message)) ||
          `refund-payment-intent returned ${res.status}`,
      };
    }
    return { ok: true, refund_id: data?.refund_id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function emailSupport(opts: {
  requestId: string;
  reservationId: string;
  paymentIntentId: string | null;
  reasonCode: string;
  reasonText: string | null;
  userId: string;
  confirmationCode: string | null;
}): Promise<void> {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) {
    console.warn("[request-refund] RESEND_API_KEY not set; skipping support email");
    return;
  }
  const resend = new Resend(resendKey);
  const supportTo = Deno.env.get("CENAIVA_SUPPORT_EMAIL") ?? "help@cenaiva.com";
  const fromAddress = Deno.env.get("RESEND_FROM_EMAIL") ??
    "Cenaiva <noreply@cenaiva.com>";

  const subject = `[Refund request] Reservation ${
    opts.confirmationCode ?? opts.reservationId.slice(0, 8)
  } — ${opts.reasonCode}`;
  const body =
    `A diner submitted a refund request via the in-app flow.\n\n` +
    `Request ID: ${opts.requestId}\n` +
    `Reservation ID: ${opts.reservationId}\n` +
    `Confirmation code: ${opts.confirmationCode ?? "(unavailable)"}\n` +
    `Payment Intent: ${opts.paymentIntentId ?? "(not supplied)"}\n` +
    `Reason: ${opts.reasonCode}\n` +
    `Diner notes: ${opts.reasonText ?? "(none)"}\n` +
    `User profile ID: ${opts.userId}\n\n` +
    `Next steps: review in Stripe + Supabase, then update refund_requests` +
    `.status to 'resolved' or 'dismissed' with a resolution_note.`;

  try {
    await resend.emails.send({
      from: fromAddress,
      to: supportTo,
      subject,
      text: body,
    });
  } catch (err) {
    console.warn(
      "[request-refund] support email failed:",
      err instanceof Error ? err.message : err,
    );
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: buildCorsHeaders(req) });
  }
  if (req.method !== "POST") return jsonRes({ error: "POST only" }, 405, req);

  const auth = await checkAuth(req, supabaseAdmin);
  if (!auth.ok) {
    return jsonRes({ error: "Unauthorized" }, 401, req);
  }

  // Resolve user_profiles.id
  const { data: profile, error: profileErr } = await supabaseAdmin
    .from("user_profiles")
    .select("id")
    .eq("auth_user_id", auth.authUserId)
    .maybeSingle();
  if (profileErr || !profile?.id) {
    console.warn("[request-refund] no profile for auth_user_id", auth.authUserId);
    return jsonRes({ error: "Profile not found" }, 404, req);
  }

  // Rate limit
  try {
    await enforceRateLimit(
      supabaseAdmin,
      "request-refund",
      rateLimitIdentifier(req, profile.id),
      { limit: 5, windowSeconds: 3600 },
    );
  } catch (err) {
    if (err instanceof RateLimitError) {
      return jsonRes({ error: err.message }, 429, req);
    }
    throw err;
  }

  const parsed = await parseJsonBody(req, RequestRefundSchema, {
    jsonRes: (b, s) => jsonRes(b, s, req),
  });
  if ("response" in parsed) return parsed.response;
  const { reservation_id, payment_intent_id, reason_code, reason_text } =
    parsed.data;

  // Look up confirmation_code for nicer support emails. Not security-
  // sensitive — even if reservation_id was guessed, we only leak the
  // confirmation code into a support email, never to the diner.
  const { data: reservation } = await supabaseAdmin
    .from("reservations")
    .select("confirmation_code, user_profile_id, guest_id")
    .eq("id", reservation_id)
    .maybeSingle();

  // Ownership: does this reservation belong to the authenticated caller?
  // Used to gate the AUTO-REFUND (money-moving) path only — a human still
  // triages plain support requests, so we don't block merely filing one.
  let callerOwnsReservation = false;
  if (reservation) {
    if (reservation.user_profile_id && reservation.user_profile_id === profile.id) {
      callerOwnsReservation = true;
    } else if (reservation.guest_id) {
      const { data: guestRow } = await supabaseAdmin
        .from("guests")
        .select("user_profile_id")
        .eq("id", reservation.guest_id)
        .maybeSingle();
      if (guestRow?.user_profile_id && guestRow.user_profile_id === profile.id) {
        callerOwnsReservation = true;
      }
    }
  }

  // Insert request row
  const { data: insertRow, error: insertErr } = await supabaseAdmin
    .from("refund_requests")
    .insert({
      user_id: profile.id,
      reservation_id,
      payment_intent_id: payment_intent_id ?? null,
      reason_code,
      reason_text: reason_text ?? null,
      status: "pending",
    })
    .select("id")
    .single();

  if (insertErr || !insertRow?.id) {
    console.error("[request-refund] insert failed:", insertErr);
    return jsonRes({ error: "Failed to create refund request" }, 500, req);
  }
  const requestId = insertRow.id;

  // Auto-refund path: ONLY for a genuine duplicate the caller actually owns.
  // Security gate (fix #2): the cross-user refund hole was that any logged-in
  // diner could pass an arbitrary pi_ and force a refund. Now the auto-refund
  // fires only when ALL hold:
  //   - the caller owns the reservation (callerOwnsReservation), AND
  //   - the supplied PI is bound to THAT reservation in our records
  //     (a charged deposit row or a paid order for it), AND
  //   - the reservation has >=2 distinct charged payments — the hallmark of a
  //     real double-charge (a single charge is not a "duplicate").
  // Anything else falls through to human triage via emailSupport (filing a
  // request is still allowed; only the money-moving auto-path is gated).
  if (reason_code === "duplicate" && payment_intent_id) {
    let autoRefundEligible = false;
    if (callerOwnsReservation) {
      const chargedPis = new Set<string>();
      const { data: depRows } = await supabaseAdmin
        .from("reservation_deposit_payments")
        .select("stripe_payment_intent_id")
        .eq("reservation_id", reservation_id)
        .eq("status", "charged");
      for (const r of depRows ?? []) {
        if (r.stripe_payment_intent_id) chargedPis.add(r.stripe_payment_intent_id);
      }
      const { data: ordRows } = await supabaseAdmin
        .from("orders")
        .select("stripe_payment_intent_id")
        .eq("reservation_id", reservation_id)
        .eq("status", "paid");
      for (const o of ordRows ?? []) {
        if (o.stripe_payment_intent_id) chargedPis.add(o.stripe_payment_intent_id);
      }
      autoRefundEligible = chargedPis.has(payment_intent_id) && chargedPis.size >= 2;
    }

    if (autoRefundEligible) {
      const refundResult = await tryAutoRefund(payment_intent_id);
      if (refundResult.ok) {
        await supabaseAdmin
          .from("refund_requests")
          .update({
            status: "auto_resolved",
            resolution_note: `Duplicate PI refunded automatically.${
              refundResult.refund_id ? ` Refund ID: ${refundResult.refund_id}` : ""
            }`,
            resolved_at: new Date().toISOString(),
          })
          .eq("id", requestId);
        return jsonRes(
          { ok: true, request_id: requestId, status: "auto_resolved" },
          200,
          req,
        );
      }
      // Auto-refund failed — leave row in pending and email support so a
      // human can intervene.
      console.warn(
        "[request-refund] auto-refund failed, falling back to support email:",
        refundResult.error,
      );
    } else {
      // Not an owned, bound, genuine duplicate — never auto-move money; let a
      // human triage. (Closes the cross-user / self-refund auto-refund hole.)
      console.warn(
        "[request-refund] auto-refund not eligible (ownership/binding/duplicate); routing to support",
        { reservation_id },
      );
    }
  }

  await emailSupport({
    requestId,
    reservationId: reservation_id,
    paymentIntentId: payment_intent_id ?? null,
    reasonCode: reason_code,
    reasonText: reason_text ?? null,
    userId: profile.id,
    confirmationCode: reservation?.confirmation_code ?? null,
  });

  return jsonRes(
    { ok: true, request_id: requestId, status: "pending" },
    200,
    req,
  );
});
