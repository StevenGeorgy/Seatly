// prepare-deposit: takes a reservation_id + a list of payers (email/full_name +
// amount_cents each) and creates `reservation_deposit_payments` rows in
// 'pending' status. Each row represents one share of the deposit. The sum of
// payer amounts must match `reservations.deposit_amount_cents`.
//
// STRIPE STUB — when Stripe is wired, this function will additionally create a
// PaymentIntent per payer and store the id on the row. For now it just records
// the rows with stripe_payment_intent_id = NULL. The companion confirm-deposit-stub
// function flips rows to 'charged' for testing.
//
// Auth: any caller with the publishable Supabase key. The function uses the
// service-role under the hood since reservation_deposit_payments has RLS
// blocking diner inserts.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { parseJsonBody } from "../_shared/validation/parse.ts";
import { PrepareDepositInputSchema } from "../_shared/validation/deposit.ts";
import { getStripeClient } from "../_shared/stripe-client.ts";

class RateLimitError extends Error {
  constructor(message: string) { super(message); this.name = "RateLimitError"; }
}
function rateLimitIdentifier(req: Request, userId?: string | null): string {
  if (userId) return `user:${userId}`;
  const xff = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return `ip:${first}`;
  }
  return "ip:unknown";
}
async function enforceRateLimit(
  client: SupabaseClient,
  scope: string,
  identifier: string,
  opts: { limit: number; windowSeconds: number },
): Promise<void> {
  const { data, error } = await client.rpc("check_rate_limit", {
    p_key: `${scope}|${identifier}`,
    p_limit: opts.limit,
    p_window_seconds: opts.windowSeconds,
  });
  if (error) return;
  if (data === false) throw new RateLimitError("Too many requests. Please wait a moment before trying again.");
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "POST only" }, 405);

  const parsed = await parseJsonBody(req, PrepareDepositInputSchema, {
    jsonRes: (body, status) => jsonResponse(body as Record<string, unknown>, status),
  });
  if ("response" in parsed) return parsed.response;

  const { reservation_id: reservationId, payers, payment_intent_id: paymentIntentId } = parsed.data;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    await enforceRateLimit(
      supabase,
      "prepare-deposit",
      rateLimitIdentifier(req, reservationId),
      { limit: 30, windowSeconds: 60 },
    );
  } catch (err) {
    if (err instanceof RateLimitError) {
      return jsonResponse({ error: err.message }, 429);
    }
    throw err;
  }

  const { data: reservation, error: reservationError } = await supabase
    .from("reservations")
    .select("id, deposit_amount_cents, deposit_status, status")
    .eq("id", reservationId)
    .single();

  if (reservationError || !reservation) {
    return jsonResponse({ error: "Reservation not found" }, 404);
  }

  const expectedTotal = Number(reservation.deposit_amount_cents ?? 0);
  if (expectedTotal <= 0) {
    return jsonResponse({ error: "Reservation does not require a deposit" }, 400);
  }

  if (reservation.deposit_status === "charged") {
    return jsonResponse({ error: "Deposit already charged" }, 409);
  }

  const runningTotal = payers.reduce((sum, p) => sum + p.amount_cents, 0);
  if (runningTotal !== expectedTotal) {
    return jsonResponse(
      {
        error: `Sum of payer amounts ($${(runningTotal / 100).toFixed(2)}) does not match reservation deposit ($${(expectedTotal / 100).toFixed(2)})`,
      },
      400,
    );
  }

  // Replace any existing pending rows so re-prepares don't pile up.
  await supabase
    .from("reservation_deposit_payments")
    .delete()
    .eq("reservation_id", reservationId)
    .eq("status", "pending");

  const { data: insertedRows, error: insertError } = await supabase
    .from("reservation_deposit_payments")
    .insert(
      payers.map((p) => ({
        reservation_id: reservationId,
        payer_email: p.email ?? null,
        payer_full_name: p.full_name ?? null,
        payer_user_profile_id: p.user_profile_id ?? null,
        amount_cents: p.amount_cents,
        status: "pending",
      })),
    )
    .select("id, payer_email, payer_full_name, amount_cents, status");

  if (insertError || !insertedRows) {
    return jsonResponse(
      { error: insertError?.message ?? "Failed to create deposit rows" },
      500,
    );
  }

  // Vuln 2 hardening (2026-05-20): when the caller pre-created a PI (inline
  // split-pay flow on RestaurantPublicPage charges before rows exist), stamp
  // the just-inserted row IDs onto the PI's `metadata.deposit_payment_ids`
  // so `confirm-deposit-paid` can verify the link. Best-effort — failure to
  // stamp doesn't block the deposit rows from existing; the confirm call
  // would just fall back to legacy mode (which is the old, less-strict
  // restaurant_id check).
  if (paymentIntentId) {
    try {
      const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
      if (stripeKey) {
        const stripe = await getStripeClient(stripeKey);
        const existing = await stripe.paymentIntents.retrieve(paymentIntentId);
        const prior = typeof existing.metadata?.deposit_payment_ids === "string"
          ? existing.metadata.deposit_payment_ids.split(",").map((s) => s.trim()).filter(Boolean)
          : [];
        const merged = Array.from(new Set([...prior, ...insertedRows.map((r) => r.id)]));
        await stripe.paymentIntents.update(paymentIntentId, {
          metadata: {
            ...(existing.metadata ?? {}),
            deposit_payment_ids: merged.join(","),
          },
        });
      }
    } catch (stampErr) {
      console.warn(
        `[prepare-deposit] could not stamp deposit_payment_ids on ${paymentIntentId}:`,
        stampErr,
      );
    }
  }

  return jsonResponse({
    reservation_id: reservationId,
    deposit_amount_cents: expectedTotal,
    payments: insertedRows.map((row) => ({
      id: row.id,
      payer_email: row.payer_email,
      payer_full_name: row.payer_full_name,
      amount_cents: row.amount_cents,
      status: row.status,
      // STRIPE STUB - replace with PaymentIntent client_secret once Stripe is wired.
      pay_url: `/deposit/${row.id}`,
    })),
  });
});
