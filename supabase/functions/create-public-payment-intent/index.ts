// create-public-payment-intent: Creates a Stripe PaymentIntent for a diner
// to pay a deposit and/or pre-order on a reservation.
//
// IMPORTANT: This function is called BEFORE the reservation row exists. The
// reservation is only created after the payment succeeds (avoids holding
// slots for users who bail mid-checkout). Metadata gets reservation_id added
// via stripe.paymentIntents.update() once the reservation is created.
//
// Fee model:
//   - 5.5% application_fee_amount to Cenaiva (taken off top via destination charge)
//   - Rest flows to restaurant's Connect account (transfer_data.destination)
//   - Cenaiva absorbs Stripe processing fees (~2.9% + 30¢) out of its 5.5%;
//     restaurants receive the full 94.5%. Destination-charge default behavior.
//   - If restaurant has no stripe_account_id (grandfathered pre-launch), uses
//     a platform-only charge — Cenaiva collects the full amount; manual payout
//     to the restaurant happens out-of-band.
//
// Two modes, fork on `saved_card_id`:
//
//   Mode A — One-time card (anon-callable, default).
//     Body: { restaurant_id, amount_cents }
//     Returns: { client_secret, payment_intent_id, mode: "one_time" }
//     Used by deferred-PaymentIntent / Stripe Elements flow. Client mounts
//     PaymentElement, calls stripe.confirmPayment with the returned secret.
//
//   Mode B — Saved card (Phase 4, 2026-05-15, JWT-required).
//     Body: { restaurant_id, amount_cents, saved_card_id }
//     Server-side: looks up the diner's saved PM, creates the PI with
//     payment_method + customer + confirm: true + off_session: true. The
//     PI is charged immediately. No Stripe Elements mount needed.
//     Returns one of:
//       { mode: "saved_card", status: "succeeded", payment_intent_id }
//       { mode: "saved_card", status: "requires_action",
//         payment_intent_id, client_secret } — caller must call
//         stripe.handleNextAction(clientSecret) for SCA.
//       { mode: "saved_card", status: "failed", error } — declined.
//
// Body: { restaurant_id: string, amount_cents: number, saved_card_id?: string }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { enforceRateLimit, rateLimitIdentifier, RateLimitError } from "../_shared/rate-limit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Payload = {
  restaurant_id?: unknown;
  amount_cents?: unknown;
  saved_card_id?: unknown;
  // Reservation-hold linkage (CENAIVA_HOLDS_ENABLED). When present, the
  // PI is created/retrieved against this hold; on success the hold row gets
  // stripe_payment_intent_id stamped so the partial-unique-index serializes
  // any concurrent PI creation for the same hold.
  hold_id?: unknown;
};

interface ReservationHoldRow {
  id: string;
  deposit_amount_cents: number | null;
  total_amount_cents: number | null;
  stripe_payment_intent_id: string | null;
  status: string | null;
  expires_at: string | null;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1];
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const decoded = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

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

const PLATFORM_FEE_PERCENT = 0.055;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonRes({ error: "POST only" }, 405);

  try {
    try {
      await enforceRateLimit(
        supabaseAdmin,
        "create-public-payment-intent",
        rateLimitIdentifier(req),
        { limit: 60, windowSeconds: 60 },
      );
    } catch (err) {
      if (err instanceof RateLimitError) return jsonRes({ error: err.message }, 429);
      throw err;
    }

    const payload = (await req.json().catch(() => ({}))) as Payload;
    const restaurantId =
      typeof payload.restaurant_id === "string" && payload.restaurant_id.trim()
        ? payload.restaurant_id.trim()
        : null;
    const amountCents =
      typeof payload.amount_cents === "number" && Number.isFinite(payload.amount_cents)
        ? Math.round(payload.amount_cents)
        : null;
    const savedCardId =
      typeof payload.saved_card_id === "string" && payload.saved_card_id.trim()
        ? payload.saved_card_id.trim()
        : null;
    const holdsEnabled = Deno.env.get("CENAIVA_HOLDS_ENABLED") === "true";
    const holdId =
      typeof payload.hold_id === "string" && payload.hold_id.trim()
        ? payload.hold_id.trim()
        : null;

    if (!restaurantId) return jsonRes({ error: "restaurant_id is required" }, 400);
    if (amountCents === null || amountCents < 50) {
      return jsonRes({ error: "amount_cents must be a number >= 50" }, 400);
    }

    const { data: restaurant, error: restErr } = await supabaseAdmin
      .from("restaurants")
      .select("id, name, stripe_account_id, currency")
      .eq("id", restaurantId)
      .maybeSingle();
    if (restErr || !restaurant) {
      return jsonRes({ error: "Restaurant not found" }, 404);
    }
    const row = restaurant as {
      id: string;
      name: string | null;
      stripe_account_id: string | null;
      currency: string | null;
    };

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) return jsonRes({ error: "Stripe is not configured on the server" }, 500);

    const { default: Stripe } = await import("npm:stripe@17");
    const stripe = new Stripe(stripeKey, { apiVersion: "2024-11-20.acacia" });

    const currency = (row.currency ?? "CAD").toLowerCase();
    const applicationFeeCents = Math.round(amountCents * PLATFORM_FEE_PERCENT);

    // reservation_id is intentionally absent here — it gets added via
    // paymentIntents.update() AFTER the reservation is created post-payment.
    const metadata: Record<string, string> = {
      restaurant_id: restaurantId,
      platform: "cenaiva",
    };

    // ── Hold-aware branch (CENAIVA_HOLDS_ENABLED) ──
    // When a hold_id is passed, we look up the hold, validate it, and either
    // (a) return the already-attached PI (idempotent retry) or
    // (b) create a new PI, stamp it onto the hold row via the partial unique
    //     index (reservation_holds_pi_unique). The unique index serializes
    //     concurrent creators — the loser retries the lookup and returns
    //     the winner's PI.
    if (holdsEnabled && holdId) {
      const { data: holdRaw, error: holdLookupErr } = await supabaseAdmin
        .from("reservation_holds")
        .select(
          "id, deposit_amount_cents, total_amount_cents, stripe_payment_intent_id, status, expires_at",
        )
        .eq("id", holdId)
        .maybeSingle();
      if (holdLookupErr) return jsonRes({ error: holdLookupErr.message }, 400);
      if (!holdRaw) return jsonRes({ error: "hold_not_found" }, 404);
      const hold = holdRaw as ReservationHoldRow;

      // Status gate — only active/converting holds can accept payment.
      if (hold.status !== "active" && hold.status !== "converting") {
        return jsonRes(
          { error: "hold_not_convertible", status: hold.status },
          409,
        );
      }
      if (hold.expires_at && new Date(hold.expires_at).getTime() < Date.now()) {
        return jsonRes(
          { error: "hold_expired", unavailable_reason: "hold_expired" },
          410,
        );
      }

      // Amount validation — must match deposit_amount_cents or
      // total_amount_cents (caller picks which one applies based on whether
      // this is a deposit-only or full-order hold).
      const depositCents = Number(hold.deposit_amount_cents ?? 0);
      const totalCents = Number(hold.total_amount_cents ?? 0);
      const amountMatches =
        (depositCents > 0 && amountCents === depositCents) ||
        (totalCents > 0 && amountCents === totalCents);
      if (!amountMatches) {
        return jsonRes(
          {
            error: "amount_mismatch",
            expected_deposit_cents: depositCents,
            expected_total_cents: totalCents,
            received_cents: amountCents,
          },
          400,
        );
      }

      // Idempotency — hold already has a PI; retrieve & return it.
      if (hold.stripe_payment_intent_id) {
        const existingPi = await stripe.paymentIntents.retrieve(
          hold.stripe_payment_intent_id,
        );
        return jsonRes({
          mode: "hold",
          status: existingPi.status,
          payment_intent_id: existingPi.id,
          client_secret: existingPi.client_secret,
          amount_cents: amountCents,
          application_fee_cents: row.stripe_account_id ? applicationFeeCents : 0,
          destination: row.stripe_account_id ?? null,
          hold_id: hold.id,
          idempotent: true,
        });
      }

      // Create a fresh PI for this hold (Mode-A-style one-time card).
      const holdStripeParams: Record<string, unknown> = {
        amount: amountCents,
        currency,
        automatic_payment_methods: { enabled: true },
        metadata: { ...metadata, hold_id: hold.id },
        description: `Reservation hold at ${row.name ?? "Cenaiva restaurant"}`,
      };
      if (row.stripe_account_id) {
        holdStripeParams.application_fee_amount = applicationFeeCents;
        holdStripeParams.transfer_data = { destination: row.stripe_account_id };
      }
      const holdPi = await stripe.paymentIntents.create(holdStripeParams);

      // Stamp the PI onto the hold row. The partial unique index
      // (reservation_holds_pi_unique on stripe_payment_intent_id) means a
      // concurrent writer hitting the same hold from the same code path
      // would normally only conflict on the SAME PI id; but if two callers
      // raced and both created different PIs, only one UPDATE succeeds — the
      // loser re-fetches and returns the winner's PI (and the losing PI is
      // orphaned in Stripe; it auto-expires unused).
      const { error: updateErr } = await supabaseAdmin
        .from("reservation_holds")
        .update({ stripe_payment_intent_id: holdPi.id })
        .eq("id", hold.id)
        .is("stripe_payment_intent_id", null);
      if (updateErr) {
        // Conflict: another caller already stamped a PI. Re-fetch and
        // return the winner's PI; the one we just created is orphaned.
        console.warn(
          "create-public-payment-intent: hold PI stamp conflict, recovering",
          updateErr,
        );
        const { data: refetched } = await supabaseAdmin
          .from("reservation_holds")
          .select("stripe_payment_intent_id")
          .eq("id", hold.id)
          .maybeSingle();
        const winningPiId = (refetched as { stripe_payment_intent_id: string | null } | null)
          ?.stripe_payment_intent_id;
        if (winningPiId) {
          const winningPi = await stripe.paymentIntents.retrieve(winningPiId);
          return jsonRes({
            mode: "hold",
            status: winningPi.status,
            payment_intent_id: winningPi.id,
            client_secret: winningPi.client_secret,
            amount_cents: amountCents,
            application_fee_cents: row.stripe_account_id ? applicationFeeCents : 0,
            destination: row.stripe_account_id ?? null,
            hold_id: hold.id,
            idempotent: true,
          });
        }
        return jsonRes({ error: "hold_pi_stamp_failed" }, 500);
      }

      // Re-verify the row actually carries the PI we created (the .is()
      // filter above silently no-ops if the row was updated between our
      // SELECT and UPDATE — Postgres returns 0 rows affected without an
      // error). If not, we lost the race; recover.
      const { data: confirmRow } = await supabaseAdmin
        .from("reservation_holds")
        .select("stripe_payment_intent_id")
        .eq("id", hold.id)
        .maybeSingle();
      const persistedPiId = (confirmRow as { stripe_payment_intent_id: string | null } | null)
        ?.stripe_payment_intent_id;
      if (persistedPiId && persistedPiId !== holdPi.id) {
        // Lost the race; return the winner.
        const winningPi = await stripe.paymentIntents.retrieve(persistedPiId);
        return jsonRes({
          mode: "hold",
          status: winningPi.status,
          payment_intent_id: winningPi.id,
          client_secret: winningPi.client_secret,
          amount_cents: amountCents,
          application_fee_cents: row.stripe_account_id ? applicationFeeCents : 0,
          destination: row.stripe_account_id ?? null,
          hold_id: hold.id,
          idempotent: true,
        });
      }

      return jsonRes({
        mode: "hold",
        status: holdPi.status,
        payment_intent_id: holdPi.id,
        client_secret: holdPi.client_secret,
        amount_cents: amountCents,
        application_fee_cents: row.stripe_account_id ? applicationFeeCents : 0,
        destination: row.stripe_account_id ?? null,
        hold_id: hold.id,
        idempotent: false,
      });
    }

    // ── Mode B: Saved card (off-session confirm) ──
    // Phase 4 of diner auth overhaul. JWT-required: we must verify the
    // saved_cards row belongs to the requesting diner before we'd allow
    // charging it. Otherwise anyone could provide any saved_card_id +
    // amount and drain saved cards.
    if (savedCardId) {
      const authHeader = req.headers.get("authorization") ?? "";
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
      if (!token) return jsonRes({ error: "Authentication required for saved-card payment" }, 401);

      const jwtPayload = decodeJwtPayload(token);
      const authUserId = jwtPayload?.sub as string | undefined;
      if (!authUserId) return jsonRes({ error: "Unauthorized" }, 401);

      const { data: profileRaw, error: profileErr } = await supabaseAdmin
        .from("user_profiles")
        .select("id, stripe_customer_id")
        .eq("auth_user_id", authUserId)
        .maybeSingle();
      if (profileErr) return jsonRes({ error: profileErr.message }, 400);
      if (!profileRaw) return jsonRes({ error: "User profile not found" }, 404);
      const profile = profileRaw as { id: string; stripe_customer_id: string | null };
      if (!profile.stripe_customer_id) {
        return jsonRes({ error: "No Stripe customer on file. Re-add your card." }, 400);
      }

      const { data: savedCardRaw, error: cardErr } = await supabaseAdmin
        .from("saved_cards")
        .select("id, stripe_payment_method_id")
        .eq("id", savedCardId)
        .eq("user_profile_id", profile.id)
        .maybeSingle();
      if (cardErr) return jsonRes({ error: cardErr.message }, 400);
      if (!savedCardRaw) {
        return jsonRes({ error: "Saved card not found" }, 404);
      }
      const savedCard = savedCardRaw as { id: string; stripe_payment_method_id: string };

      const savedCardParams: Record<string, unknown> = {
        amount: amountCents,
        currency,
        customer: profile.stripe_customer_id,
        payment_method: savedCard.stripe_payment_method_id,
        off_session: true,
        confirm: true,
        metadata: { ...metadata, saved_card_id: savedCard.id },
        description: `Reservation at ${row.name ?? "Cenaiva restaurant"}`,
      };

      if (row.stripe_account_id) {
        // Same destination-charge pattern as the one-time path.
        // Funds settle to the restaurant's Connect account; the 5.5%
        // application fee stays with Cenaiva.
        savedCardParams.application_fee_amount = applicationFeeCents;
        savedCardParams.transfer_data = { destination: row.stripe_account_id };
      }

      let paymentIntent;
      try {
        paymentIntent = await stripe.paymentIntents.create(savedCardParams);
      } catch (stripeErr) {
        const code = (stripeErr as { code?: string }).code;
        const msg = stripeErr instanceof Error ? stripeErr.message : String(stripeErr);
        // SCA challenge case: Stripe attached the PI but it needs the
        // user to re-authenticate (3D Secure). The error payload carries
        // the PI's client_secret for handleNextAction.
        const piFromError = (stripeErr as { raw?: { payment_intent?: { id?: string; client_secret?: string } } })
          .raw?.payment_intent;
        if (code === "authentication_required" && piFromError?.client_secret) {
          return jsonRes({
            mode: "saved_card",
            status: "requires_action",
            payment_intent_id: piFromError.id ?? null,
            client_secret: piFromError.client_secret,
          });
        }
        return jsonRes({
          mode: "saved_card",
          status: "failed",
          error: msg,
        }, 402);
      }

      if (paymentIntent.status === "requires_action") {
        return jsonRes({
          mode: "saved_card",
          status: "requires_action",
          payment_intent_id: paymentIntent.id,
          client_secret: paymentIntent.client_secret,
        });
      }
      if (paymentIntent.status === "succeeded" || paymentIntent.status === "processing") {
        return jsonRes({
          mode: "saved_card",
          status: "succeeded",
          payment_intent_id: paymentIntent.id,
          amount_cents: amountCents,
          application_fee_cents: row.stripe_account_id ? applicationFeeCents : 0,
          destination: row.stripe_account_id ?? null,
        });
      }
      return jsonRes({
        mode: "saved_card",
        status: "failed",
        error: `Unexpected PI status: ${paymentIntent.status}`,
      }, 402);
    }

    // ── Mode A: One-time card (deferred PI, default path) ──
    const stripeParams: Record<string, unknown> = {
      amount: amountCents,
      currency,
      automatic_payment_methods: { enabled: true },
      metadata,
      description: `Reservation at ${row.name ?? "Cenaiva restaurant"}`,
    };

    if (row.stripe_account_id) {
      // Destination charge: funds settle to restaurant's Connect account.
      // application_fee_amount is taken off the top for Cenaiva.
      stripeParams.application_fee_amount = applicationFeeCents;
      stripeParams.transfer_data = { destination: row.stripe_account_id };
    }
    // If no Connect account, this becomes a platform-only charge; manual
    // payout to the restaurant happens out-of-band. Pre-launch fallback.

    const paymentIntent = await stripe.paymentIntents.create(stripeParams);

    return jsonRes({
      mode: "one_time",
      client_secret: paymentIntent.client_secret,
      payment_intent_id: paymentIntent.id,
      amount_cents: amountCents,
      application_fee_cents: row.stripe_account_id ? applicationFeeCents : 0,
      destination: row.stripe_account_id ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonRes({ error: msg }, 500);
  }
});
