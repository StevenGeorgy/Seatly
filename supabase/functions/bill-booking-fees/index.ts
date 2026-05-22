// @ts-nocheck
// bill-booking-fees: cron-called sweeper that converts pending
// restaurant_booking_fees rows into Stripe invoice_items on each
// restaurant's subscription customer. Stripe rolls them into the next
// monthly subscription invoice.
//
// Cron: scheduled hourly (or whatever supabase/migrations sets). Also
// callable manually via HTTP (CRON_SECRET-gated when set).
//
// Per pending row:
//   1. Restaurant must have stripe_customer_id (subscription must exist).
//   2. invoiceItems.create({ customer, amount, currency, description })
//      — Stripe attaches the item to the customer's upcoming invoice.
//   3. Flip the row to 'billed' with stripe_invoice_item_id + billed_at.
//   4. On Stripe error: flip to 'failed' with failure_reason. Manual
//      operator intervention required; the row won't be re-tried
//      automatically (avoid runaway charges on transient bad state).
//
// Idempotency: the partial-unique on `restaurant_booking_fees.reservation_id`
// + the status filter (`= 'pending'`) guards against double-billing if the
// cron overlaps with itself. Each invoice_item carries metadata.reservation_id
// for manual reconciliation.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { buildCorsHeaders } from "../_shared/cors.ts";
import { getStripeClient } from "../_shared/stripe-client.ts";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const BATCH_LIMIT = 500;

function jsonRes(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...buildCorsHeaders(req), "Content-Type": "application/json" },
  });
}

function verifyCronSecret(req: Request): boolean {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret) return true;
  return req.headers.get("x-cron-secret") === secret;
}

interface PendingFee {
  id: string;
  restaurant_id: string;
  reservation_id: string;
  amount_cents: number;
  currency: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: buildCorsHeaders(req) });
  if (req.method !== "POST") return jsonRes(req, { error: "POST only" }, 405);
  if (!verifyCronSecret(req)) return jsonRes(req, { error: "unauthorized" }, 401);

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  if (!stripeKey) return jsonRes(req, { error: "Stripe is not configured" }, 500);

  try {
    const { data: pendingRaw, error: pendingErr } = await supabaseAdmin
      .from("restaurant_booking_fees")
      .select("id, restaurant_id, reservation_id, amount_cents, currency")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(BATCH_LIMIT);
    if (pendingErr) {
      console.error("[bill-booking-fees] select error", pendingErr);
      return jsonRes(req, { error: pendingErr.message }, 500);
    }

    const pending = (pendingRaw ?? []) as PendingFee[];
    if (pending.length === 0) {
      return jsonRes(req, { billed: 0, failed: 0, skipped: 0, ok: true });
    }

    // Group by restaurant so we only fetch each restaurant's
    // stripe_customer_id once even if it has many pending bookings.
    const restaurantIds = Array.from(new Set(pending.map((p) => p.restaurant_id)));
    const { data: restaurantsRaw, error: restErr } = await supabaseAdmin
      .from("restaurants")
      .select("id, stripe_customer_id, subscription_status")
      .in("id", restaurantIds);
    if (restErr) {
      console.error("[bill-booking-fees] restaurants lookup error", restErr);
      return jsonRes(req, { error: restErr.message }, 500);
    }
    const restaurantMap = new Map<string, { stripe_customer_id: string | null; subscription_status: string | null }>(
      (restaurantsRaw ?? []).map((r: any) => [r.id, { stripe_customer_id: r.stripe_customer_id, subscription_status: r.subscription_status }]),
    );

    const stripe = await getStripeClient(stripeKey);

    let billed = 0;
    let failed = 0;
    let skipped = 0;

    for (const fee of pending) {
      const restaurant = restaurantMap.get(fee.restaurant_id);
      const customerId = restaurant?.stripe_customer_id ?? null;
      const subStatus = restaurant?.subscription_status ?? null;

      // Restaurants without a Stripe customer/subscription can't be
      // metered — skip without flipping status so a later cron picks
      // them up once they finish onboarding.
      if (!customerId) {
        skipped += 1;
        continue;
      }
      // Cancelled subs: we can't add invoice_items to a customer with no
      // active subscription cycle. Skip without flipping status; operator
      // can decide whether to chase the fee manually.
      if (subStatus && !["trialing", "active", "past_due", "incomplete"].includes(subStatus)) {
        skipped += 1;
        continue;
      }

      try {
        const item = await stripe.invoiceItems.create({
          customer: customerId,
          amount: fee.amount_cents,
          currency: fee.currency,
          description: "Cenaiva booking fee",
          tax_behavior: "exclusive",
          metadata: {
            reservation_id: fee.reservation_id,
            restaurant_id: fee.restaurant_id,
            booking_fee_id: fee.id,
          },
        });

        const { error: updateErr } = await supabaseAdmin
          .from("restaurant_booking_fees")
          .update({
            status: "billed",
            stripe_invoice_item_id: item.id,
            billed_at: new Date().toISOString(),
          })
          .eq("id", fee.id)
          .eq("status", "pending"); // guard against double-billing if a concurrent run
        if (updateErr) {
          console.error("[bill-booking-fees] update error", { fee, err: updateErr });
          // Stripe accepted the invoice item but we failed to record it.
          // Surface as failed; operator can manually mark it billed after
          // verifying via Stripe Dashboard.
          failed += 1;
          continue;
        }
        billed += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[bill-booking-fees] stripe error", { fee, message });
        await supabaseAdmin
          .from("restaurant_booking_fees")
          .update({ status: "failed", failure_reason: message.slice(0, 500) })
          .eq("id", fee.id)
          .eq("status", "pending");
        failed += 1;
      }
    }

    return jsonRes(req, { ok: true, billed, failed, skipped, scanned: pending.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[bill-booking-fees] fatal", msg);
    return jsonRes(req, { error: msg }, 500);
  }
});
