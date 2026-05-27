// create-public-payment-intent: Creates a Stripe PaymentIntent for a diner
// to pay a deposit and/or pre-order on a reservation.
//
// IMPORTANT: This function is called BEFORE the reservation row exists. The
// reservation is only created after the payment succeeds (avoids holding
// slots for users who bail mid-checkout). Metadata gets reservation_id added
// via stripe.paymentIntents.update() once the reservation is created.
//
// Fee model (2026-05-19 update — diner pays Stripe fee on top):
//   - Diner pays base + Stripe processing fee (2.9% + 30¢ grossed up).
//     `amount_cents` in the payload is the BASE (the deposit/preorder amount
//     the diner agreed to); the PaymentIntent `amount` is the grossed-up
//     diner total. Server returns `processing_fee_cents` so the UI can show
//     it as a line item.
//   - 5.5% application_fee_amount to Cenaiva, computed on the BASE (we don't
//     take commission on the pass-through Stripe fee we don't keep).
//   - Restaurant nets 94.5% of base after Stripe's fee and our 5.5%.
//   - If restaurant has no stripe_account_id (grandfathered pre-launch), the
//     same gross-up still applies but Cenaiva collects the full amount;
//     manual payout to the restaurant happens out-of-band.
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
import { computeDinerCharge } from "../_shared/stripe-fee.ts";
import { getStripeClient } from "../_shared/stripe-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Payload = {
  restaurant_id?: unknown;
  amount_cents?: unknown;
  // Tax portion (HST/GST) that passes through to the restaurant. Cenaiva
  // does NOT take commission on tax. Folded into the diner-pays-all-fees
  // gross-up via computeDinerCharge(food, tax). When omitted, treated as 0
  // (pre-tax callers like deposit-only and legacy clients keep working).
  tax_cents?: unknown;
  saved_card_id?: unknown;
  // Deposit-link metadata (Vuln 2 hardening 2026-05-20). When the client
  // creates a PI for one or more `reservation_deposit_payments` rows, it
  // passes their UUIDs here. We stamp the comma-joined list on the PI's
  // metadata at create time. `confirm-deposit-paid` then asserts the
  // payment_id it's about to settle is in this list — closing PI-substitution
  // attacks across deposits within the same restaurant.
  deposit_payment_ids?: unknown;
  // Reservation-hold linkage (CENAIVA_HOLDS_ENABLED). When present, the
  // PI is created/retrieved against this hold; on success the hold row gets
  // stripe_payment_intent_id stamped so the partial-unique-index serializes
  // any concurrent PI creation for the same hold.
  hold_id?: unknown;
  // Save-card flag (2026-05-20 fix). When true AND a valid bearer token is
  // present, the PI is created with `customer` + `setup_future_usage` so
  // Stripe saves the PM during the charge. The post-charge attach call
  // (stripe-attach-payment-method) then just records the saved_cards row.
  // Without this flag, the diner pays one-time and the PM is detached.
  save_card?: unknown;
  // Client-generated idempotency key (Vuln 110 fix, 2026-05-21). The
  // saved-card paths used to derive the Stripe idempotency key from
  // `${profile.id}_${card}_${amount}` — which collided across separate
  // bookings by the same diner for the same deposit amount. Stripe would
  // return the first booking's PI for every subsequent booking, causing
  // refunds to hit the wrong PI. The client now generates a fresh UUID
  // per booking attempt and passes it here; legitimate retries of the
  // same attempt reuse it. Cap length so a malicious client can't blow
  // out Stripe's 255-char idempotency-key limit.
  idempotency_key?: unknown;
};

interface ReservationHoldRow {
  id: string;
  deposit_amount_cents: number | null;
  total_amount_cents: number | null;
  stripe_payment_intent_id: string | null;
  status: string | null;
  expires_at: string | null;
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

// Resolve a saved card identifier to its Stripe PaymentMethod id. Accepts
// either a saved_cards.id UUID or a raw Stripe PM id (pm_*) — the diner
// UI's stripe-list-methods returns pm_* directly when there is no saved_cards
// row yet, so charging paths must accept both shapes.
async function resolveSavedCard(
  // deno-lint-ignore no-explicit-any
  client: any,
  profileId: string,
  savedCardId: string,
): Promise<{ id: string | null; stripe_payment_method_id: string } | null> {
  if (savedCardId.startsWith("pm_")) {
    const { data } = await client
      .from("saved_cards")
      .select("id, stripe_payment_method_id")
      .eq("user_profile_id", profileId)
      .eq("stripe_payment_method_id", savedCardId)
      .maybeSingle();
    if (data) return data;
    // Allow charging a Stripe PM the customer owns but that has no
    // saved_cards row yet (UI shows it via stripe-list-methods which lists
    // directly from Stripe). We'll verify customer-ownership at the
    // PaymentIntent layer (Stripe enforces PM is attached to the customer
    // before allowing off-session confirm).
    return { id: null, stripe_payment_method_id: savedCardId };
  }
  const { data } = await client
    .from("saved_cards")
    .select("id, stripe_payment_method_id")
    .eq("id", savedCardId)
    .eq("user_profile_id", profileId)
    .maybeSingle();
  return data ?? null;
}

// Charge a saved card against an active hold. Used when both saved_card_id
// and hold_id are present on the request — runs the saved-card off-session
// confirm flow and stamps the resulting PI onto the hold row so the
// reservation settle path can find it.
async function chargeSavedCardWithHold(opts: {
  req: Request;
  // deno-lint-ignore no-explicit-any
  stripe: any;
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any;
  savedCardId: string;
  holdId: string;
  restaurantId: string;
  restaurantName: string;
  stripeAccountId: string | null;
  amountCents: number;
  taxCents: number;
  dinerTotalCents: number;
  processingFeeCents: number;
  applicationFeeCents: number;
  currency: string;
  metadata: Record<string, string>;
  clientIdempotencyKey: string | null;
}): Promise<{ body: Record<string, unknown>; status: number }> {
  const authHeader = opts.req.headers.get("Authorization") ?? opts.req.headers.get("authorization") ?? "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!bearerToken) {
    return { body: { error: "auth_required" }, status: 401 };
  }
  const { data: { user }, error: authError } = await opts.supabaseAdmin.auth.getUser(bearerToken);
  if (authError || !user) return { body: { error: "invalid_token" }, status: 401 };
  const authUserId = user.id;

  const { data: profileRaw, error: profileErr } = await opts.supabaseAdmin
    .from("user_profiles")
    .select("id, stripe_customer_id")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  if (profileErr) return { body: { error: profileErr.message }, status: 400 };
  if (!profileRaw) return { body: { error: "User profile not found" }, status: 404 };
  const profile = profileRaw as { id: string; stripe_customer_id: string | null };
  if (!profile.stripe_customer_id) {
    return {
      body: { error: "No Stripe customer on file. Re-add your card." },
      status: 400,
    };
  }

  const savedCard = await resolveSavedCard(
    opts.supabaseAdmin,
    profile.id,
    opts.savedCardId,
  );
  if (!savedCard) return { body: { error: "Saved card not found" }, status: 404 };

  const params: Record<string, unknown> = {
    amount: opts.dinerTotalCents,
    currency: opts.currency,
    customer: profile.stripe_customer_id,
    payment_method: savedCard.stripe_payment_method_id,
    off_session: true,
    confirm: true,
    metadata: {
      ...opts.metadata,
      saved_card_id: savedCard.id ?? savedCard.stripe_payment_method_id,
      hold_id: opts.holdId,
      base_amount_cents: String(opts.amountCents),
      tax_cents: String(opts.taxCents),
      processing_fee_cents: String(opts.processingFeeCents),
    },
    description: `Reservation at ${opts.restaurantName}`,
  };
  if (opts.stripeAccountId) {
    params.application_fee_amount = opts.applicationFeeCents;
    params.transfer_data = { destination: opts.stripeAccountId };
  }

  let paymentIntent;
  try {
    // Idempotency: same hold + same diner-paying amount → same PI within
    // Stripe's 24h window. Prevents double-charge on browser retry after
    // a 5xx, or on a fast double-tap of Place Order.
    // Idempotency: prefer the client-supplied attempt key (Bug #110 fix —
    // every fresh booking gets a new UUID so Stripe doesn't return a prior
    // booking's PI on subsequent attempts). Fall back to the legacy
    // amount-derived key only when no client key is supplied (covers older
    // mobile builds that don't yet send `idempotency_key`).
    const idempKey = opts.clientIdempotencyKey
      ?? `saved_card_${opts.holdId ?? opts.profile.id}_${opts.dinerTotalCents}`;
    paymentIntent = await opts.stripe.paymentIntents.create(params, {
      idempotencyKey: idempKey,
    });
  } catch (stripeErr) {
    const code = (stripeErr as { code?: string }).code;
    const msg = stripeErr instanceof Error ? stripeErr.message : String(stripeErr);
    const piFromError = (stripeErr as {
      raw?: { payment_intent?: { id?: string; client_secret?: string } };
    }).raw?.payment_intent;
    if (code === "authentication_required" && piFromError?.client_secret) {
      // Stamp the failed-but-resumable PI on the hold so the SCA continuation
      // can find it after the diner completes the 3DS challenge.
      if (piFromError.id) {
        await opts.supabaseAdmin
          .from("reservation_holds")
          .update({ stripe_payment_intent_id: piFromError.id })
          .eq("id", opts.holdId)
          .is("stripe_payment_intent_id", null);
      }
      return {
        body: {
          mode: "saved_card",
          status: "requires_action",
          payment_intent_id: piFromError.id ?? null,
          client_secret: piFromError.client_secret,
          hold_id: opts.holdId,
        },
        status: 200,
      };
    }
    return {
      body: { mode: "saved_card", status: "failed", error: msg },
      status: 402,
    };
  }

  // Stamp PI onto the hold so reservation creation post-charge can wire it up.
  await opts.supabaseAdmin
    .from("reservation_holds")
    .update({ stripe_payment_intent_id: paymentIntent.id })
    .eq("id", opts.holdId)
    .is("stripe_payment_intent_id", null);

  if (paymentIntent.status === "requires_action") {
    return {
      body: {
        mode: "saved_card",
        status: "requires_action",
        payment_intent_id: paymentIntent.id,
        client_secret: paymentIntent.client_secret,
        hold_id: opts.holdId,
      },
      status: 200,
    };
  }
  if (paymentIntent.status === "succeeded" || paymentIntent.status === "processing") {
    return {
      body: {
        mode: "saved_card",
        status: "succeeded",
        payment_intent_id: paymentIntent.id,
        base_amount_cents: opts.amountCents,
        amount_cents: opts.dinerTotalCents,
        processing_fee_cents: opts.processingFeeCents,
        application_fee_cents: opts.stripeAccountId ? opts.applicationFeeCents : 0,
        destination: opts.stripeAccountId ?? null,
        hold_id: opts.holdId,
      },
      status: 200,
    };
  }
  return {
    body: {
      mode: "saved_card",
      status: "failed",
      error: `Unexpected PI status: ${paymentIntent.status}`,
    },
    status: 402,
  };
}

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
    // tax_cents: optional pass-through HST/GST. Validated bounds match
    // amount_cents (0 to $100k CAD). Missing / non-numeric → 0.
    const taxCentsRaw =
      typeof payload.tax_cents === "number" && Number.isFinite(payload.tax_cents)
        ? Math.round(payload.tax_cents)
        : 0;
    const taxCents =
      taxCentsRaw >= 0 && taxCentsRaw <= 10_000_000 ? taxCentsRaw : 0;
    const savedCardId =
      typeof payload.saved_card_id === "string" && payload.saved_card_id.trim()
        ? payload.saved_card_id.trim()
        : null;
    const holdsEnabled = Deno.env.get("CENAIVA_HOLDS_ENABLED") === "true";
    const holdId =
      typeof payload.hold_id === "string" && payload.hold_id.trim()
        ? payload.hold_id.trim()
        : null;
    const saveCard = payload.save_card === true;
    // Client-supplied idempotency key (UUID per booking attempt). See
    // Payload.idempotency_key comment for rationale. Cap to 240 chars
    // to stay under Stripe's 255-char limit even with our prefix.
    const clientIdempotencyKey =
      typeof payload.idempotency_key === "string"
        && payload.idempotency_key.trim().length > 0
        && payload.idempotency_key.trim().length <= 240
        ? payload.idempotency_key.trim()
        : null;
    // Parse + validate deposit_payment_ids — array of UUIDs (max 16 to bound
    // the metadata size; Stripe caps each metadata value at 500 chars and
    // 16 UUIDs comma-joined fits comfortably).
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const depositPaymentIds: string[] = Array.isArray(payload.deposit_payment_ids)
      ? (payload.deposit_payment_ids as unknown[])
          .filter((v): v is string => typeof v === "string" && UUID_RE.test(v.trim()))
          .map((v) => v.trim())
          .slice(0, 16)
      : [];

    // ── Resolve save-card customer (2026-05-20 fix) ─────────────────────
    // If the diner is logged in AND ticked "save this card", we need to
    // create the PI with `customer` + `setup_future_usage: 'off_session'`
    // so Stripe saves the PM during the charge. Otherwise the post-charge
    // attach-payment-method call fails with 400 (PMs from destination
    // charges are one-time-use and can't be re-attached after the fact).
    //
    // This is a no-op for guest checkouts (no bearer token) — they pay
    // one-time and no save happens.
    let saveCardCustomerId: string | null = null;
    if (saveCard) {
      const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
      const bearerToken = authHeader.startsWith("Bearer ")
        ? authHeader.slice(7)
        : null;
      if (bearerToken) {
        const { data: { user: saveCardUser } } = await supabaseAdmin.auth.getUser(bearerToken);
        const authUserId = saveCardUser?.id;
        if (authUserId) {
          const { data: profileRaw } = await supabaseAdmin
            .from("user_profiles")
            .select("id, full_name, email, stripe_customer_id")
            .eq("auth_user_id", authUserId)
            .maybeSingle();
          const profile = profileRaw as {
            id: string;
            full_name: string | null;
            email: string | null;
            stripe_customer_id: string | null;
          } | null;
          if (profile) {
            saveCardCustomerId = profile.stripe_customer_id;
            // Lazy-create the Stripe customer the first time the diner
            // saves a card. Mirrors stripe-attach-payment-method's pattern.
            if (!saveCardCustomerId) {
              const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
              if (stripeKey) {
                const stripe = await getStripeClient(stripeKey);
                const customer = await stripe.customers.create({
                  email: profile.email || undefined,
                  name: profile.full_name || undefined,
                  metadata: { user_profile_id: profile.id },
                });
                saveCardCustomerId = customer.id;
                await supabaseAdmin
                  .from("user_profiles")
                  .update({ stripe_customer_id: saveCardCustomerId })
                  .eq("id", profile.id);
              }
            }
          }
        }
      }
    }

    if (!restaurantId) return jsonRes({ error: "restaurant_id is required" }, 400);
    // Lower bound: Stripe minimum charge ($0.50). Upper bound (Vuln C3,
    // 2026-05-20): $100k CAD. Stripe rejects > $999,999.99 with
    // amount_too_large but explicit cap prevents accidental gross-up
    // overflow on misuse.
    if (amountCents === null || amountCents < 50 || amountCents > 10_000_000) {
      return jsonRes({ error: "amount_cents must be between 50 and 10,000,000" }, 400);
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

    const stripe = await getStripeClient(stripeKey);

    const currency = (row.currency ?? "CAD").toLowerCase();
    const charge = computeDinerCharge(amountCents, taxCents);
    const dinerTotalCents = charge.dinerTotalCents;
    const processingFeeCents = charge.processingFeeCents;
    const applicationFeeCents = charge.applicationFeeCents;

    // reservation_id is intentionally absent here — it gets added via
    // paymentIntents.update() AFTER the reservation is created post-payment.
    const metadata: Record<string, string> = {
      restaurant_id: restaurantId,
      platform: "cenaiva",
    };
    // Stamp deposit_payment_ids onto every branch via the shared metadata
    // object (3 paths spread `...metadata`). confirm-deposit-paid asserts
    // intent.metadata.deposit_payment_ids includes the payment_id it's
    // settling. See Vuln 2 hardening, 2026-05-20.
    if (depositPaymentIds.length > 0) {
      metadata.deposit_payment_ids = depositPaymentIds.join(",");
      // Also stamp reservation_id so stripe-webhook can resolve the
      // reservation if confirm-deposit-paid never runs (tab closed
      // mid-flow). Webhook handler keys off pi.metadata.reservation_id
      // at stripe-webhook/index.ts:525. Look it up from the FIRST row
      // (all rows in a split share the same reservation_id).
      const { data: depositLookup } = await supabaseAdmin
        .from("reservation_deposit_payments")
        .select("reservation_id")
        .eq("id", depositPaymentIds[0])
        .maybeSingle();
      const linkedReservationId = (depositLookup as { reservation_id: string | null } | null)
        ?.reservation_id;
      if (linkedReservationId) {
        metadata.reservation_id = linkedReservationId;
      }
    }

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
      // 'converted' is treated as benign skip: the hold was already
      // converted (e.g. by create-public-booking's split-tender path which
      // converts the hold + inserts N deposit_payment rows up-front).
      // Fall through to the standard non-hold deposit_payment_ids path so
      // a regular PI gets created bound to the deposit row via metadata.
      if (hold.status === "converted") {
        // Sentinel: skip the rest of the hold-binding logic by setting a
        // flag that the closing block honors. JS doesn't have a clean
        // "break out of a labeled if" so we use the pattern below.
      } else if (hold.status !== "active" && hold.status !== "converting") {
        return jsonRes(
          { error: "hold_not_convertible", status: hold.status },
          409,
        );
      } else if (true) {
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
          base_amount_cents: amountCents,
          amount_cents: dinerTotalCents,
          processing_fee_cents: processingFeeCents,
          application_fee_cents: row.stripe_account_id ? applicationFeeCents : 0,
          destination: row.stripe_account_id ?? null,
          hold_id: hold.id,
          idempotent: true,
        });
      }

      // Saved-card + hold: off-session confirm + stamp PI on hold row.
      // Frontend's saved-card handler expects mode:"saved_card" with
      // status:"succeeded"|"requires_action"|"failed".
      if (savedCardId) {
        const savedCardResult = await chargeSavedCardWithHold({
          req,
          stripe,
          supabaseAdmin,
          savedCardId,
          holdId: hold.id,
          restaurantId,
          restaurantName: row.name ?? "Cenaiva restaurant",
          stripeAccountId: row.stripe_account_id,
          amountCents,
          taxCents,
          dinerTotalCents,
          processingFeeCents,
          applicationFeeCents,
          currency,
          metadata,
          clientIdempotencyKey,
        });
        return jsonRes(savedCardResult.body, savedCardResult.status);
      }

      // Create a fresh PI for this hold (Mode-A-style one-time card).
      // automatic_payment_methods with allow_redirects: "never" enables card
      // + same-page wallets (Apple Pay, Google Pay, Link, Interac) per
      // diner's locale + restaurant's Stripe dashboard config, while
      // excluding redirect-flow methods like Klarna/Affirm/Sofort that
      // would break the in-page Stripe Elements UX.
      const holdStripeParams: Record<string, unknown> = {
        amount: dinerTotalCents,
        currency,
        automatic_payment_methods: { enabled: true, allow_redirects: "never" },
        metadata: {
          ...metadata,
          hold_id: hold.id,
          base_amount_cents: String(amountCents),
          tax_cents: String(taxCents),
          processing_fee_cents: String(processingFeeCents),
        },
        description: `Reservation hold at ${row.name ?? "Cenaiva restaurant"}`,
      };
      if (row.stripe_account_id) {
        holdStripeParams.application_fee_amount = applicationFeeCents;
        holdStripeParams.transfer_data = { destination: row.stripe_account_id };
      }
      // Save-card path: tell Stripe to save the PM during charge so the
      // diner sees it in their saved cards next time. Required because
      // destination-charge PMs are one-time-use otherwise.
      if (saveCardCustomerId) {
        holdStripeParams.customer = saveCardCustomerId;
        holdStripeParams.setup_future_usage = "off_session";
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
            base_amount_cents: amountCents,
            amount_cents: dinerTotalCents,
            processing_fee_cents: processingFeeCents,
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
          base_amount_cents: amountCents,
          amount_cents: dinerTotalCents,
          processing_fee_cents: processingFeeCents,
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
        base_amount_cents: amountCents,
        amount_cents: dinerTotalCents,
        processing_fee_cents: processingFeeCents,
        application_fee_cents: row.stripe_account_id ? applicationFeeCents : 0,
        destination: row.stripe_account_id ?? null,
        hold_id: hold.id,
        idempotent: false,
      });
      } // end else if (hold.status active/converting)
    }

    // ── Mode B: Saved card (off-session confirm) ──
    // Phase 4 of diner auth overhaul. JWT-required: we must verify the
    // saved_cards row belongs to the requesting diner before we'd allow
    // charging it. Otherwise anyone could provide any saved_card_id +
    // amount and drain saved cards.
    if (savedCardId) {
      const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
      const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
      if (!bearerToken) return jsonRes({ error: "auth_required" }, 401);
      const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(bearerToken);
      if (authError || !user) return jsonRes({ error: "invalid_token" }, 401);
      const authUserId = user.id;

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

      const savedCard = await resolveSavedCard(supabaseAdmin, profile.id, savedCardId);
      if (!savedCard) return jsonRes({ error: "Saved card not found" }, 404);

      const savedCardParams: Record<string, unknown> = {
        amount: dinerTotalCents,
        currency,
        customer: profile.stripe_customer_id,
        payment_method: savedCard.stripe_payment_method_id,
        off_session: true,
        confirm: true,
        metadata: {
          ...metadata,
          saved_card_id: savedCard.id ?? savedCard.stripe_payment_method_id,
          base_amount_cents: String(amountCents),
          tax_cents: String(taxCents),
          processing_fee_cents: String(processingFeeCents),
        },
        description: `Reservation at ${row.name ?? "Cenaiva restaurant"}`,
      };

      if (row.stripe_account_id) {
        // Same destination-charge pattern as the one-time path.
        // Funds settle to the restaurant's Connect account; the 2.2%
        // application fee stays with Cenaiva.
        savedCardParams.application_fee_amount = applicationFeeCents;
        savedCardParams.transfer_data = { destination: row.stripe_account_id };
      }

      let paymentIntent;
      try {
        // Idempotency: same diner + same saved card + same amount → same
        // PI within Stripe's 24h window. Mode-B saved-card path
        // (no hold) needed a key — earlier audit (2026-05-20) flagged
        // this as a double-charge risk on browser retry.
        // Same Bug #110 fix as chargeSavedCardWithHold — prefer client UUID
        // so distinct bookings by the same diner get distinct PIs.
        const idempKey = clientIdempotencyKey
          ?? `saved_card_b_${profile.id}_${savedCard.id ?? savedCard.stripe_payment_method_id}_${dinerTotalCents}`;
        paymentIntent = await stripe.paymentIntents.create(savedCardParams, {
          idempotencyKey: idempKey,
        });
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
          base_amount_cents: amountCents,
          amount_cents: dinerTotalCents,
          processing_fee_cents: processingFeeCents,
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
    // automatic_payment_methods enables card + same-page wallets (Apple Pay,
    // Google Pay, Link, Interac). allow_redirects: "never" excludes BNPL /
    // bank-redirect flows that would leave the in-page Stripe Elements UX.
    const stripeParams: Record<string, unknown> = {
      amount: dinerTotalCents,
      currency,
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      metadata: {
        ...metadata,
        base_amount_cents: String(amountCents),
        tax_cents: String(taxCents),
        processing_fee_cents: String(processingFeeCents),
      },
      description: `Reservation at ${row.name ?? "Cenaiva restaurant"}`,
    };

    if (row.stripe_account_id) {
      // Destination charge: funds settle to restaurant's Connect account.
      // application_fee_amount is 2.2% of BASE (not the grossed-up total).
      stripeParams.application_fee_amount = applicationFeeCents;
      stripeParams.transfer_data = { destination: row.stripe_account_id };
    }
    // If no Connect account, this becomes a platform-only charge; manual
    // payout to the restaurant happens out-of-band. Pre-launch fallback.

    // Save-card path: see hold-side comment above. customer +
    // setup_future_usage saves the PM during the charge so it's reusable.
    if (saveCardCustomerId) {
      stripeParams.customer = saveCardCustomerId;
      stripeParams.setup_future_usage = "off_session";
    }

    const paymentIntent = await stripe.paymentIntents.create(stripeParams);

    return jsonRes({
      mode: "one_time",
      client_secret: paymentIntent.client_secret,
      payment_intent_id: paymentIntent.id,
      base_amount_cents: amountCents,
      amount_cents: dinerTotalCents,
      processing_fee_cents: processingFeeCents,
      application_fee_cents: row.stripe_account_id ? applicationFeeCents : 0,
      destination: row.stripe_account_id ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonRes({ error: msg }, 500);
  }
});
