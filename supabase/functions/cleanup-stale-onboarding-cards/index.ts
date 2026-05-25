// @ts-nocheck
// cleanup-stale-onboarding-cards: cron-driven sweeper (daily ~4am UTC) that
// detaches saved cards from restaurants who attached a payment method but
// never published. The rule is: if `payment_method_attached_at` is older
// than 90 days AND the restaurant is still unpublished, the card was likely
// abandoned. Detach it from the Stripe customer and clear the timestamp so
// the publish gate goes back to requiring re-attach.
//
// Pattern matches bill-booking-fees: x-cron-secret header gate, batched up
// to 500 restaurants per run, per-PM error-tolerant detach loop.

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

interface StaleRow {
  id: string;
  stripe_customer_id: string | null;
  payment_method_attached_at: string | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: buildCorsHeaders(req) });
  if (req.method !== "POST") return jsonRes(req, { error: "POST only" }, 405);
  if (!verifyCronSecret(req)) return jsonRes(req, { error: "unauthorized" }, 401);

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  if (!stripeKey) return jsonRes(req, { error: "Stripe is not configured" }, 500);

  try {
    const cutoff = new Date(Date.now() - 90 * 86400 * 1000).toISOString();
    // Note: the 90-day cutoff on `payment_method_attached_at` already
    // excludes any actively-used wizards — no need for a separate
    // "recent updated_at" guard.

    const { data: rowsRaw, error: selectErr } = await supabaseAdmin
      .from("restaurants")
      .select("id, stripe_customer_id, payment_method_attached_at")
      .eq("is_published", false)
      .not("payment_method_attached_at", "is", null)
      .lt("payment_method_attached_at", cutoff)
      .limit(BATCH_LIMIT);
    if (selectErr) {
      console.error("[cleanup-stale-onboarding-cards] select error", selectErr);
      return jsonRes(req, { error: selectErr.message }, 500);
    }

    const rows = (rowsRaw ?? []) as StaleRow[];
    if (rows.length === 0) {
      return jsonRes(req, { ok: true, processed: 0, detached: 0, errors: [] });
    }

    const stripe = await getStripeClient(stripeKey);

    let processed = 0;
    let detached = 0;
    const errors: Array<{ restaurant_id: string; error: string }> = [];

    for (const row of rows) {
      processed += 1;

      // Track whether every card on the customer was successfully
      // detached. If anything failed (Stripe list error OR per-card
      // detach error), leave the timestamp set so the next cron run
      // retries. Previously we cleared the timestamp regardless,
      // creating a DB↔Stripe divergence where the card was still
      // attached server-side but the DB said "no card on file."
      let allDetached = true;

      if (row.stripe_customer_id) {
        try {
          const pmList = await stripe.paymentMethods.list({
            customer: row.stripe_customer_id,
            type: "card",
            limit: 20,
          });
          for (const pm of pmList.data) {
            try {
              await stripe.paymentMethods.detach(pm.id);
              detached += 1;
            } catch (detachErr) {
              const msg = detachErr instanceof Error ? detachErr.message : String(detachErr);
              console.error(
                `[cleanup-stale-onboarding-cards] detach failed pm=${pm.id} restaurant=${row.id}`,
                msg,
              );
              errors.push({ restaurant_id: row.id, error: `detach:${pm.id}:${msg}` });
              allDetached = false;
            }
          }
        } catch (listErr) {
          const msg = listErr instanceof Error ? listErr.message : String(listErr);
          console.error(
            `[cleanup-stale-onboarding-cards] list failed restaurant=${row.id}`,
            msg,
          );
          errors.push({ restaurant_id: row.id, error: `list:${msg}` });
          allDetached = false;
        }
      }

      if (!allDetached) {
        // Skip clearing the timestamp so the next run retries this row.
        continue;
      }

      const { error: updateErr } = await supabaseAdmin
        .from("restaurants")
        .update({ payment_method_attached_at: null })
        .eq("id", row.id);
      if (updateErr) {
        console.error(
          `[cleanup-stale-onboarding-cards] update failed restaurant=${row.id}`,
          updateErr,
        );
        errors.push({ restaurant_id: row.id, error: `update:${updateErr.message}` });
      }
    }

    return jsonRes(req, { ok: true, processed, detached, errors });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cleanup-stale-onboarding-cards] fatal", msg);
    return jsonRes(req, { error: msg }, 500);
  }
});
