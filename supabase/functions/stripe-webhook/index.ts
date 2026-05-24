// stripe-webhook: Phase D (Stripe wire-up). Receives Stripe webhook events
// and mirrors them into restaurant rows. No JWT auth — Stripe POSTs directly
// and we verify the `stripe-signature` header using STRIPE_WEBHOOK_SECRET.
//
// `verify_jwt = false` in supabase/config.toml.
//
// Events handled (matches STRIPE_SETUP.md §1.5):
//   account.updated                       → sync charges/payouts/details booleans
//   account.application.deauthorized      → clear stripe_account_id + flags
//   customer.subscription.created/updated → mirror subscription_status + trial_ends_at
//   customer.subscription.deleted         → mark canceled + is_published=false (graceful unpublish)
//   customer.subscription.trial_will_end  → log only (could email later)
//   payment_intent.succeeded / failed     → log only (deposit flow webhook handles its own)
//   invoice.payment_failed                → log only

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { enforceRateLimit, rateLimitIdentifier, RateLimitError } from "../_shared/rate-limit.ts";
import { getStripeClient } from "../_shared/stripe-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "stripe-signature, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

// Persistent dedup via `stripe_webhook_events` (PRIMARY KEY on event_id).
// Stripe delivers at-least-once; if we ever process the same event twice
// (e.g. retry storm, edge fn restart, parallel deliveries) the downstream
// handlers can produce duplicate side effects (double-charging deposits,
// stale subscription_status overwrites). The in-memory Set we used before
// reset on every edge function cold start — useless for retry windows
// that span minutes.
//
// INSERT ... ON CONFLICT DO NOTHING is atomic. If the row already existed,
// `rowCount === 0` and we return false (skip). Otherwise we own the event.
async function rememberEvent(
  eventId: string,
  eventType: string,
  requestId: string | null,
): Promise<boolean> {
  try {
    const { error, count } = await supabaseAdmin
      .from("stripe_webhook_events")
      .insert(
        {
          event_id: eventId,
          event_type: eventType,
          request_id: requestId,
          source: "stripe",
        },
        { count: "exact" },
      );
    if (error) {
      // PostgREST returns code 23505 on unique-violation; treat as "already
      // processed" rather than letting it surface as a 500 below.
      if ((error as { code?: string }).code === "23505") return false;
      console.error("[stripe-webhook] dedup insert failed", error);
      // Fail-open: process anyway. Better to double-process once than to
      // drop an event entirely on a transient DB error.
      return true;
    }
    return (count ?? 0) > 0;
  } catch (err) {
    console.error("[stripe-webhook] dedup insert threw", err);
    return true; // Fail-open
  }
}

type AccountLike = {
  id?: string;
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  details_submitted?: boolean;
  requirements?: {
    currently_due?: string[] | null;
    past_due?: string[] | null;
    pending_verification?: string[] | null;
    disabled_reason?: string | null;
  } | null;
};

type SubscriptionLike = {
  id?: string;
  customer?: string;
  status?: string;
  trial_end?: number | null;
  cancel_at_period_end?: boolean | null;
  pause_collection?: { behavior?: string | null } | null;
};

type InvoiceLineLike = {
  amount?: number;
  description?: string | null;
  quantity?: number | null;
  price?: { id?: string; recurring?: { interval?: string } | null } | null;
};

type InvoiceLike = {
  id?: string;
  customer?: string;
  amount_paid?: number;
  amount_due?: number;
  currency?: string;
  status?: string;
  number?: string | null;
  hosted_invoice_url?: string | null;
  invoice_pdf?: string | null;
  status_transitions?: { paid_at?: number | null } | null;
  lines?: { data?: InvoiceLineLike[] } | null;
};

type PaymentIntentLike = {
  id?: string;
  amount?: number;
  status?: string;
  metadata?: Record<string, string>;
  last_payment_error?: { message?: string } | null;
};

type DisputeLike = {
  id?: string;
  charge?: string;
  payment_intent?: string;
  amount?: number;
  currency?: string;
  reason?: string;
  status?: string;
  evidence_details?: { due_by?: number | null } | null;
};

async function handleAccountUpdated(account: AccountLike): Promise<void> {
  if (!account.id) return;
  // Derive requirements_due / requirements_processing per Stripe's recommended
  // UI logic (https://docs.stripe.com/connect/handling-api-verification):
  //   - currently_due / past_due items NOT in pending_verification → action needed
  //   - pending_verification items + nothing actionable → Stripe is processing
  // We compute these here (webhook is the source of truth, not polling) so the
  // wizard / dashboard can read DB columns instead of calling Stripe live.
  // That eliminates the "yellow flash" caused by Stripe's post-submit
  // propagation lag where currently_due briefly stays populated after the
  // owner has actually finished.
  // Canonical Stripe rule (per https://docs.stripe.com/connect/handling-api-verification):
  //   - currently_due / past_due items NOT in pending_verification → user action needed
  //   - pending_verification non-empty AND nothing actionable → Stripe processing
  // We deliberately ignore `disabled_reason` here. Its values (e.g. "requirements.past_due",
  // "requirements.pending_verification", "rejected.fraud", "under_review") are informational
  // and tricky to parse — `currently_due` + `pending_verification` are the source of truth.
  const reqs = account.requirements ?? {};
  const pendingSet = new Set(reqs.pending_verification ?? []);
  const actionableCurrentlyDue = (reqs.currently_due ?? []).filter(
    (f) => !pendingSet.has(f),
  );
  const actionablePastDue = (reqs.past_due ?? []).filter((f) => !pendingSet.has(f));
  const requirementsDue =
    actionableCurrentlyDue.length > 0 || actionablePastDue.length > 0;
  const requirementsProcessing =
    (reqs.pending_verification ?? []).length > 0 && !requirementsDue;

  const { error } = await supabaseAdmin
    .from("restaurants")
    .update({
      stripe_charges_enabled: Boolean(account.charges_enabled),
      stripe_payouts_enabled: Boolean(account.payouts_enabled),
      stripe_details_submitted: Boolean(account.details_submitted),
      stripe_requirements_due: requirementsDue,
      stripe_requirements_processing: requirementsProcessing,
    })
    .eq("stripe_account_id", account.id);
  if (error) console.error("[stripe-webhook] account.updated failed", error);
}

async function handleAccountDeauthorized(account: AccountLike): Promise<void> {
  if (!account.id) return;
  const { error } = await supabaseAdmin
    .from("restaurants")
    .update({
      stripe_account_id: null,
      stripe_charges_enabled: false,
      stripe_payouts_enabled: false,
      stripe_details_submitted: false,
    })
    .eq("stripe_account_id", account.id);
  if (error) console.error("[stripe-webhook] account.deauthorized failed", error);
}

async function dispatchOwnerNotification(
  restaurantId: string,
  type:
    | "payment_failed"
    | "payment_recovered"
    | "payment_received"
    | "charge_dispute_created"
    | "charge_dispute_closed",
  context: Record<string, unknown>,
): Promise<void> {
  // Helper may not exist on first deploy — wrap in try/catch so webhook
  // processing never fails on a missing import.
  try {
    const mod = await import("../_shared/owner-notifications.ts").catch(() => null);
    if (
      mod &&
      typeof (mod as { sendOwnerNotification?: unknown }).sendOwnerNotification === "function"
    ) {
      void (mod as {
        sendOwnerNotification: (opts: Record<string, unknown>) => Promise<unknown>;
      })
        .sendOwnerNotification({
          supabase: supabaseAdmin,
          restaurant_id: restaurantId,
          type,
          context,
        })
        .catch((e: unknown) => {
          console.warn(
            "[stripe-webhook] sendOwnerNotification rejected",
            e instanceof Error ? e.message : String(e),
          );
        });
    }
  } catch (notifErr) {
    console.warn(
      "[stripe-webhook] notification import/dispatch failed",
      notifErr instanceof Error ? notifErr.message : String(notifErr),
    );
  }
}

// invoice.payment_succeeded — fires when Stripe charges the owner's monthly
// subscription invoice (subscription + accumulated booking-fee invoiceItems).
// We:
//   1) Look up the restaurant by stripe_customer_id
//   2) Insert 2 rows into `expenses` (subscription + booking-fee summary) with
//      external_ref=invoice.id so replays don't duplicate
//   3) Fire the payment_received notification (Resend email)
//
// Idempotency: pre-check on (restaurant_id, external_ref). If any row exists
// for this invoice id, we skip the entire flow. Replays land here harmlessly.
async function handleInvoicePaymentSucceeded(invoice: InvoiceLike): Promise<void> {
  if (!invoice.id || !invoice.customer) {
    console.warn("[stripe-webhook] invoice.payment_succeeded missing id/customer");
    return;
  }

  // 1) Find the restaurant by customer id
  const { data: restRow, error: restErr } = await supabaseAdmin
    .from("restaurants")
    .select("id, name, email, currency")
    .eq("stripe_customer_id", invoice.customer)
    .maybeSingle();
  if (restErr || !restRow) {
    console.warn(
      "[stripe-webhook] invoice.payment_succeeded: no restaurant for customer",
      invoice.customer,
      restErr,
    );
    return;
  }
  const restaurant = restRow as {
    id: string;
    name: string | null;
    email: string | null;
    currency: string | null;
  };

  // 2) Idempotency pre-check — has any expense row already been written for
  // this invoice? If yes, skip the whole flow (notification + insert).
  const { data: existing } = await supabaseAdmin
    .from("expenses")
    .select("id")
    .eq("restaurant_id", restaurant.id)
    .eq("external_ref", invoice.id)
    .limit(1);
  if (existing && existing.length > 0) {
    console.log(
      `[stripe-webhook] invoice.payment_succeeded ${invoice.id}: already processed (expense row exists), skipping`,
    );
    return;
  }

  // 3) Compute the line items. Stripe rolls all invoiceItems + the
  // subscription line into invoice.lines.data.
  //   - "Cenaiva subscription" line = the subscription line item (has
  //     `price.recurring` set)
  //   - "Cenaiva booking fee" lines = the per-booking invoiceItems we
  //     created via bill-booking-fees
  // We aggregate booking fees into ONE expense row (description shows the
  // count). The subscription is its own row.
  const lines = invoice.lines?.data ?? [];
  let subscriptionCents = 0;
  let bookingFeesCents = 0;
  let bookingCount = 0;
  for (const line of lines) {
    const amount = typeof line.amount === "number" ? line.amount : 0;
    const isRecurring = Boolean(line.price?.recurring);
    if (isRecurring) {
      subscriptionCents += amount;
    } else {
      // Treat any non-subscription line as a booking fee (bill-booking-fees
      // is currently the only source of pending invoiceItems for these
      // customers).
      bookingFeesCents += amount;
      bookingCount += typeof line.quantity === "number" ? line.quantity : 1;
    }
  }

  // 4) Look up an owner profile to use as `created_by` on the inserted rows
  // (expenses.created_by is NOT NULL). Any owner role works; pick the
  // earliest.
  const { data: ownerRow } = await supabaseAdmin
    .from("user_restaurant_roles")
    .select("user_id")
    .eq("restaurant_id", restaurant.id)
    .eq("role", "owner")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const createdBy = (ownerRow as { user_id?: string } | null)?.user_id ?? null;
  if (!createdBy) {
    console.warn(
      `[stripe-webhook] invoice.payment_succeeded ${invoice.id}: no owner role found for restaurant ${restaurant.id}; skipping expense rows`,
    );
  }

  // 5) Insert expense rows. Currency column expects lowercase 3-char code.
  const currency = (invoice.currency ?? restaurant.currency ?? "cad").toLowerCase();
  const paidAtIso = invoice.status_transitions?.paid_at
    ? new Date(invoice.status_transitions.paid_at * 1000).toISOString()
    : new Date().toISOString();
  const expenseDate = paidAtIso.slice(0, 10); // YYYY-MM-DD

  const rowsToInsert: Array<Record<string, unknown>> = [];
  if (createdBy && subscriptionCents > 0) {
    const dollars = Math.round(subscriptionCents) / 100;
    rowsToInsert.push({
      restaurant_id: restaurant.id,
      created_by: createdBy,
      category: "other", // closest fit; no software_subscriptions category exists
      vendor_name: "Cenaiva",
      description: "Cenaiva subscription",
      amount: dollars,
      total_amount: dollars,
      currency,
      expense_date: expenseDate,
      payment_status: "paid",
      paid_at: paidAtIso,
      transaction_type: "expense",
      external_ref: invoice.id,
      source: "auto:cenaiva",
    });
  }
  if (createdBy && bookingFeesCents > 0) {
    const dollars = Math.round(bookingFeesCents) / 100;
    rowsToInsert.push({
      restaurant_id: restaurant.id,
      created_by: createdBy,
      category: "other",
      vendor_name: "Cenaiva",
      description: `Cenaiva booking fees (${bookingCount} booking${bookingCount === 1 ? "" : "s"})`,
      amount: dollars,
      total_amount: dollars,
      currency,
      expense_date: expenseDate,
      payment_status: "paid",
      paid_at: paidAtIso,
      transaction_type: "expense",
      external_ref: invoice.id,
      source: "auto:cenaiva",
    });
  }

  if (rowsToInsert.length > 0) {
    const { error: insertErr } = await supabaseAdmin
      .from("expenses")
      .insert(rowsToInsert);
    if (insertErr) {
      console.error(
        `[stripe-webhook] invoice.payment_succeeded ${invoice.id}: expense insert failed`,
        insertErr,
      );
      // Don't bail — still try to fire the email notification below.
    }
  }

  // 6) Fire the payment_received notification (Resend email).
  const totalCents =
    typeof invoice.amount_paid === "number" ? invoice.amount_paid : 0;
  const amountStr = `$${(Math.round(totalCents) / 100).toFixed(2)} ${currency.toUpperCase()}`;
  const paidOnStr = new Date(paidAtIso).toLocaleDateString("en-CA", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  await dispatchOwnerNotification(restaurant.id, "payment_received", {
    amount: amountStr,
    paidOn: paidOnStr,
    hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
    invoicePdfUrl: invoice.invoice_pdf ?? null,
    invoiceNumber: invoice.number ?? null,
    bookingCount,
    restaurantName: restaurant.name ?? "your restaurant",
  });

  console.log(
    `[stripe-webhook] invoice.payment_succeeded ${invoice.id}: processed (sub=${subscriptionCents}¢, fees=${bookingFeesCents}¢ from ${bookingCount} bookings)`,
  );
}

async function handleSubscriptionUpsert(sub: SubscriptionLike): Promise<void> {
  if (!sub.customer) return;
  const trialEndsAt =
    typeof sub.trial_end === "number" ? new Date(sub.trial_end * 1000).toISOString() : null;
  const status = sub.status ?? null;
  // Mirror cancel/pause flags so the dashboard + lifecycle controls pick
  // up the latest state without waiting for the user to refresh. Both
  // optional — only override the column when the field is present on the
  // event payload.
  const cancelAtPeriodEnd =
    typeof sub.cancel_at_period_end === "boolean" ? sub.cancel_at_period_end : null;
  const pauseBehavior = sub.pause_collection?.behavior ?? null;
  const update: Record<string, unknown> = {
    subscription_status: status,
    trial_ends_at: trialEndsAt,
  };
  if (cancelAtPeriodEnd !== null) {
    update.subscription_cancel_at_period_end = cancelAtPeriodEnd;
  }
  // When `pause_collection` is set (any non-null behavior) treat as paused;
  // when explicitly null on the event, clear the local timestamp.
  if (sub.pause_collection !== undefined) {
    update.subscription_paused_at = pauseBehavior
      ? new Date().toISOString()
      : null;
  }

  // Look up the current restaurant state to drive the right side-effect.
  const { data: rest } = await supabaseAdmin
    .from("restaurants")
    .select("id, is_published, paused_reason, deleted_at, name, email")
    .eq("stripe_customer_id", sub.customer)
    .maybeSingle();

  if (!rest) {
    // No matching row yet (rare race with create-customer). Mirror status
    // without touching publish flags.
    const { error } = await supabaseAdmin
      .from("restaurants")
      .update(update)
      .eq("stripe_customer_id", sub.customer);
    if (error) console.error("[stripe-webhook] subscription upsert (no-rest) failed", error);
    return;
  }

  const row = rest as {
    id: string;
    is_published: boolean | null;
    paused_reason: string | null;
    deleted_at: string | null;
    name: string | null;
    email: string | null;
  };

  // Mid-deletion: never republish, never overwrite the deletion banner.
  // Just mirror the Stripe status fields and stop.
  if (row.deleted_at !== null) {
    const { error } = await supabaseAdmin
      .from("restaurants")
      .update(update)
      .eq("stripe_customer_id", sub.customer);
    if (error) console.error("[stripe-webhook] subscription upsert (deleted) failed", error);
    return;
  }

  const wasPaymentFailed = row.paused_reason === "payment_failed";
  let firedPaymentFailed = false;
  let firedPaymentRecovered = false;

  if (status === "unpaid" || status === "canceled") {
    update.is_published = false;
    update.paused_reason = "payment_failed";
    if (!wasPaymentFailed) firedPaymentFailed = true;
  } else if (status === "trialing" || status === "active") {
    if (wasPaymentFailed) {
      // Recovery path. The publish-gate trigger will reject if other
      // conditions (KYC, cover photo) aren't met — that's fine; the row's
      // is_published stays false and the owner gets a notification anyway.
      update.is_published = true;
      update.paused_reason = null;
      firedPaymentRecovered = true;
    }
  }
  // 'past_due' / 'incomplete': leave publish flags alone — Stripe is still
  // retrying. We only react to terminal-ish states.

  const { error } = await supabaseAdmin
    .from("restaurants")
    .update(update)
    .eq("stripe_customer_id", sub.customer);
  if (error) console.error("[stripe-webhook] subscription upsert failed", error);

  // Fire owner-notification emails on the transitions we care about.
  if (firedPaymentFailed && row.email) {
    await dispatchOwnerNotification(row.id, "payment_failed", {
      restaurant_name: row.name,
      subscription_status: status,
    });
  }
  if (firedPaymentRecovered && row.email) {
    await dispatchOwnerNotification(row.id, "payment_recovered", {
      restaurant_name: row.name,
      subscription_status: status,
    });
  }
}

async function handlePaymentIntentSucceeded(pi: PaymentIntentLike): Promise<void> {
  if (!pi.id) return;

  // NEW BRANCH: hold-based PIs (reservation-hold feature, Phase B).
  // PIs created against a reservation_hold carry `hold_id` in metadata.
  // The browser confirm-hold-paid edge fn races us; whichever calls
  // convert_reservation_hold_to_reservation first wins, the second is a
  // no-op (idempotent: true). If the hold has already expired past the
  // grace window we refund — the webhook is the source of truth for
  // "payment actually happened", so refunds belong here, NOT in
  // confirm-hold-paid.
  const holdId = (pi.metadata as Record<string, string> | undefined)?.hold_id ?? null;
  if (holdId) {
    try {
      const { data, error } = await supabaseAdmin.rpc(
        "convert_reservation_hold_to_reservation",
        { p_hold_id: holdId, p_payment_intent_id: pi.id, p_grace_seconds: 120 },
      );
      if ((error as { code?: string } | null)?.code === "P0011") {
        // Hold expired past grace — initiate refund (best-effort, log on fail).
        console.error("stripe-webhook: hold expired past grace, refunding", { hold_id: holdId, pi_id: pi.id });
        try {
          const stripeKeyForRefund = Deno.env.get("STRIPE_SECRET_KEY");
          if (stripeKeyForRefund) {
            const { default: StripeRefund } = await import("npm:stripe@17");
            const stripeForRefund = new StripeRefund(stripeKeyForRefund, { apiVersion: "2024-11-20.acacia" });
            await stripeForRefund.refunds.create({
              payment_intent: pi.id,
              reason: "requested_by_customer",
            });
          } else {
            console.error("stripe-webhook: cannot refund expired hold, STRIPE_SECRET_KEY missing");
          }
        } catch (refundErr) {
          console.error("refund failed", refundErr);
        }
        return;
      }
      if (error) {
        console.error("convert_reservation_hold_to_reservation failed in webhook", error);
        return;
      }
      // Post-conversion side effects (orders insert, promotion usage,
      // notifications). Only on the first conversion — idempotent replays
      // must not double-fire.
      const row = (data as Array<{ reservation_id: string; idempotent: boolean }> | null)?.[0];
      if (row && !row.idempotent) {
        try {
          const { runPostHoldConversion } = await import("../_shared/hold-conversion.ts");
          await runPostHoldConversion({
            supabase: supabaseAdmin,
            holdId,
            reservationId: row.reservation_id,
            paymentIntentId: pi.id,
          });
        } catch (sideErr) {
          console.error("[stripe-webhook] post-conversion side effect failed", sideErr);
        }
      }
      return;
    } catch (e) {
      console.error("hold conversion path failed", e);
      return;
    }
  }

  // EXISTING reservation_id path — preserves Phase D legacy bookings whose
  // PIs carry `reservation_id` metadata instead of `hold_id`. Both paths
  // coexist while the reservation-hold rollout is in progress.
  const reservationId = pi.metadata?.reservation_id ?? null;
  const orderId = pi.metadata?.order_id ?? null;
  if (!reservationId) {
    console.log(`[stripe-webhook] payment_intent.succeeded ${pi.id} — no reservation_id in metadata, skipping`);
    return;
  }
  // Mark all pending deposit payment rows for this reservation as 'charged'.
  // The reservation_deposit_payments settle trigger then flips the reservation
  // to 'confirmed' (see supabase/migrations/*_deposit_policy.sql).
  const { error: depErr } = await supabaseAdmin
    .from("reservation_deposit_payments")
    .update({ status: "charged", stripe_payment_intent_id: pi.id, paid_at: new Date().toISOString() })
    .eq("reservation_id", reservationId)
    .eq("status", "pending");
  if (depErr) console.error("[stripe-webhook] deposit row update failed", depErr);
  // If there's an associated pre-order, mark it paid too.
  if (orderId) {
    const { error: ordErr } = await supabaseAdmin
      .from("orders")
      .update({ status: "paid", stripe_payment_intent_id: pi.id })
      .eq("id", orderId);
    if (ordErr) console.error("[stripe-webhook] order paid update failed", ordErr);
  }
  // If the reservation has no deposit (pre-order-only), make sure the
  // reservation is confirmed manually since the deposit trigger won't fire.
  await supabaseAdmin
    .from("reservations")
    .update({ status: "confirmed" })
    .eq("id", reservationId)
    .in("status", ["pending", "pending_payment"]);
}

async function handlePaymentIntentFailed(pi: PaymentIntentLike): Promise<void> {
  if (!pi.id) return;
  const reservationId = pi.metadata?.reservation_id ?? null;
  if (!reservationId) return;
  const message = pi.last_payment_error?.message ?? "Card was declined";
  const { error } = await supabaseAdmin
    .from("reservation_deposit_payments")
    .update({ status: "failed", stripe_payment_intent_id: pi.id })
    .eq("reservation_id", reservationId)
    .eq("status", "pending");
  if (error) console.error("[stripe-webhook] payment_intent.failed update failed", error);
  console.log(`[stripe-webhook] payment_intent.failed for ${reservationId}: ${message}`);

  // Owner heads-up notification (fire-and-forget). Pulled at the
  // metadata layer so we don't burden the deposit-row update path
  // with an extra await. Wrapped in a try/catch + .catch so a missing
  // helper or transient failure never blocks the webhook response.
  try {
    const restaurantIdMeta = pi.metadata?.restaurant_id ?? null;
    let restaurantId: string | null = typeof restaurantIdMeta === "string" ? restaurantIdMeta : null;
    let guestName: string | null = null;
    let guestEmail: string | null = null;
    if (!restaurantId || !guestName) {
      const { data: row } = await supabaseAdmin
        .from("reservations")
        .select("restaurant_id, guest_full_name, guest_email")
        .eq("id", reservationId)
        .maybeSingle();
      restaurantId = restaurantId ?? (row as any)?.restaurant_id ?? null;
      guestName = (row as any)?.guest_full_name ?? null;
      guestEmail = (row as any)?.guest_email ?? null;
    }
    if (restaurantId) {
      const mod = await import("../_shared/owner-notifications.ts").catch(() => null);
      if (
        mod &&
        typeof (mod as { notifyOwnerDinerPaymentFailed?: unknown }).notifyOwnerDinerPaymentFailed === "function"
      ) {
        void (mod as {
          notifyOwnerDinerPaymentFailed: (opts: Record<string, unknown>) => Promise<unknown>;
        })
          .notifyOwnerDinerPaymentFailed({
            supabase: supabaseAdmin,
            restaurant_id: restaurantId,
            reservation_id: reservationId,
            amount_cents: typeof pi.amount === "number" ? pi.amount : 0,
            failure_reason: message,
            guest_name: guestName ?? undefined,
            guest_email: guestEmail ?? undefined,
          })
          .catch((e: unknown) => {
            console.warn(
              "[stripe-webhook] notifyOwnerDinerPaymentFailed rejected",
              e instanceof Error ? e.message : String(e),
            );
          });
      }
    }
  } catch (err) {
    console.warn(
      "[stripe-webhook] payment_failed owner notify threw",
      err instanceof Error ? err.message : String(err),
    );
  }
}

async function handleChargeDispute(eventType: string, dispute: DisputeLike): Promise<void> {
  if (!dispute.id || !dispute.payment_intent) {
    console.warn("[stripe-webhook] dispute missing id/payment_intent", {
      eventType,
      id: dispute.id,
    });
    return;
  }
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  if (!stripeKey) {
    console.error("[stripe-webhook] STRIPE_SECRET_KEY missing");
    return;
  }
  const stripe = await getStripeClient(stripeKey);

  let pi: { id: string; metadata?: Record<string, string> | null } | null = null;
  try {
    pi = (await stripe.paymentIntents.retrieve(dispute.payment_intent, {
      expand: ["latest_charge"],
    })) as { id: string; metadata?: Record<string, string> | null };
  } catch (err) {
    console.error("[stripe-webhook] failed to retrieve PI for dispute", err);
    return;
  }
  if (!pi) return;

  // Resolve restaurant_id via metadata → DB fallback
  let restaurantId: string | null = pi.metadata?.restaurant_id ?? null;
  let reservationId: string | null = pi.metadata?.reservation_id ?? null;
  if (!restaurantId) {
    const { data: depRow } = await supabaseAdmin
      .from("reservation_deposit_payments")
      .select("reservation_id, reservations(restaurant_id, confirmation_code, guest_full_name)")
      .eq("stripe_payment_intent_id", pi.id)
      .maybeSingle();
    if (depRow) {
      reservationId = (depRow as { reservation_id?: string | null }).reservation_id ?? reservationId;
      restaurantId =
        (depRow as { reservations?: { restaurant_id?: string | null } | null }).reservations
          ?.restaurant_id ?? null;
    }
  }
  if (!restaurantId) {
    console.warn("[stripe-webhook] no restaurant_id resolvable for dispute", { piId: pi.id });
    return;
  }

  // Look up reservation details for the confirmation code
  let confirmationCode: string | null = null;
  if (reservationId) {
    const { data: r } = await supabaseAdmin
      .from("reservations")
      .select("confirmation_code")
      .eq("id", reservationId)
      .maybeSingle();
    confirmationCode = (r as { confirmation_code?: string | null } | null)?.confirmation_code ?? null;
  }

  const amountDollars = ((dispute.amount ?? 0) / 100).toFixed(2);
  let evidenceDueBy: string | null = null;
  if (dispute.evidence_details?.due_by) {
    const d = new Date(dispute.evidence_details.due_by * 1000);
    evidenceDueBy = new Intl.DateTimeFormat("en-CA", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: "America/Toronto",
    }).format(d);
  }

  if (eventType === "charge.dispute.created") {
    await dispatchOwnerNotification(restaurantId, "charge_dispute_created", {
      amount: amountDollars,
      reservation_code: confirmationCode,
      reason: dispute.reason ?? null,
      evidence_due_by: evidenceDueBy,
      payment_intent_id: pi.id,
    });
  } else if (eventType === "charge.dispute.closed") {
    const status = dispute.status ?? "warning_closed";
    const outcome: "won" | "lost" | "warning_closed" =
      status === "won" || status === "lost" ? status : "warning_closed";
    await dispatchOwnerNotification(restaurantId, "charge_dispute_closed", {
      amount: amountDollars,
      reservation_code: confirmationCode,
      outcome,
      payment_intent_id: pi.id,
    });
  }
}

async function handleSubscriptionDeleted(sub: SubscriptionLike): Promise<void> {
  if (!sub.customer) return;
  // Skip restaurants in the soft-delete pipeline — they have their own
  // `paused_reason='pending_deletion'` we shouldn't overwrite.
  const { error } = await supabaseAdmin
    .from("restaurants")
    .update({
      subscription_status: "canceled",
      is_published: false,
      paused_reason: "subscription_cancelled",
      subscription_cancel_at_period_end: false,
      subscription_paused_at: null,
    })
    .eq("stripe_customer_id", sub.customer)
    .neq("paused_reason", "pending_deletion");
  if (error) console.error("[stripe-webhook] subscription deleted failed", error);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonRes({ error: "POST only" }, 405);

  try {
    await enforceRateLimit(
      supabaseAdmin,
      "stripe-webhook",
      rateLimitIdentifier(req),
      { limit: 60, windowSeconds: 60 },
    );
  } catch (err) {
    if (err instanceof RateLimitError) return jsonRes({ error: err.message }, 429);
    // Fail-open on infra errors so we don't drop real Stripe events.
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return jsonRes({ error: "Missing stripe-signature" }, 400);

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  // Dual-secret verification: Stripe sends Connect events from one endpoint
  // (signed with STRIPE_WEBHOOK_SECRET) and platform-account events from
  // another (signed with STRIPE_WEBHOOK_SECRET_PLATFORM). The handler accepts
  // either signature so a single function serves both endpoints. We try each
  // in order — whichever verifies wins.
  const candidateSecrets = [
    Deno.env.get("STRIPE_WEBHOOK_SECRET"),
    Deno.env.get("STRIPE_WEBHOOK_SECRET_PLATFORM"),
  ].filter((s): s is string => Boolean(s));
  if (!stripeKey || candidateSecrets.length === 0) {
    return jsonRes({ error: "Stripe webhook not configured" }, 500);
  }

  const rawBody = await req.text();

  const stripe = await getStripeClient(stripeKey);

  let event: { id: string; type: string; data: { object: Record<string, unknown> } } | null = null;
  let lastErr: unknown = null;
  for (const sec of candidateSecrets) {
    try {
      event = (await stripe.webhooks.constructEventAsync(
        rawBody,
        signature,
        sec,
      )) as { id: string; type: string; data: { object: Record<string, unknown> } };
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!event) {
    const msg = lastErr instanceof Error ? lastErr.message : "Signature verification failed";
    return jsonRes({ error: `Webhook signature verification failed: ${msg}` }, 400);
  }

  const requestId = req.headers.get("stripe-signature")
    ? (event.request as { id?: string } | null)?.id ?? null
    : null;
  if (!(await rememberEvent(event.id, event.type, requestId))) {
    console.log(`[stripe-webhook] duplicate event ${event.id} (${event.type}) — skipping`);
    return jsonRes({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case "account.updated":
        await handleAccountUpdated(event.data.object as AccountLike);
        break;
      case "account.application.deauthorized":
        await handleAccountDeauthorized(event.data.object as AccountLike);
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
        await handleSubscriptionUpsert(event.data.object as SubscriptionLike);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object as SubscriptionLike);
        break;
      case "customer.subscription.trial_will_end":
        console.log(`[stripe-webhook] trial_will_end for ${event.id}`);
        break;
      case "payment_intent.succeeded":
        await handlePaymentIntentSucceeded(event.data.object as PaymentIntentLike);
        break;
      case "payment_intent.payment_failed":
        await handlePaymentIntentFailed(event.data.object as PaymentIntentLike);
        break;
      case "invoice.payment_failed":
        console.log(`[stripe-webhook] ${event.type} (${event.id}) — logged, no DB write`);
        break;
      case "invoice.payment_succeeded":
        await handleInvoicePaymentSucceeded(event.data.object as InvoiceLike);
        break;
      case "invoice.finalized":
        // Reserved — fires when Stripe locks in the bill (about to charge).
        // We could send a "your bill is ready" notification here later. For
        // now just log it so we can see the events arriving.
        console.log(`[stripe-webhook] invoice.finalized (${event.id}) — logged, no DB write`);
        break;
      case "charge.dispute.created":
      case "charge.dispute.closed":
        await handleChargeDispute(event.type, event.data.object as DisputeLike);
        break;
      case "charge.dispute.updated":
        console.log(`[stripe-webhook] charge.dispute.updated (${event.id}) — logged, no action`);
        break;
      default:
        console.log(`[stripe-webhook] unhandled event ${event.type} (${event.id})`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[stripe-webhook] handler error for ${event.type}:`, msg);
    // Still return 200 — Stripe will retry on non-2xx, but the handler is
    // best-effort. The next account.updated / subscription.updated event
    // will re-sync state.
  }

  return jsonRes({ received: true });
});
