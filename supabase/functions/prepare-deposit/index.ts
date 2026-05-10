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

// Inlined from supabase/functions/_shared/rate-limit.ts so this function can
// be deployed standalone without bundling a shared file.
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

type PayerInput = {
  email?: unknown;
  full_name?: unknown;
  amount_cents?: unknown;
  user_profile_id?: unknown;
};

type Payload = {
  reservation_id?: unknown;
  payers?: PayerInput[];
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

  let payload: Payload;
  try {
    payload = (await req.json()) as Payload;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const reservationId =
    typeof payload.reservation_id === "string" && payload.reservation_id.trim()
      ? payload.reservation_id.trim()
      : null;
  if (!reservationId) {
    return jsonResponse({ error: "reservation_id is required" }, 400);
  }

  const payers = Array.isArray(payload.payers) ? payload.payers : [];
  if (payers.length === 0) {
    return jsonResponse({ error: "payers must be a non-empty array" }, 400);
  }
  if (payers.length > 50) {
    return jsonResponse({ error: "Too many payers (max 50)" }, 400);
  }

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

  const normalizedPayers: Array<{
    payer_email: string | null;
    payer_full_name: string | null;
    payer_user_profile_id: string | null;
    amount_cents: number;
  }> = [];
  let runningTotal = 0;

  for (let i = 0; i < payers.length; i += 1) {
    const p = payers[i];
    const email =
      typeof p.email === "string" && p.email.trim() ? p.email.trim().toLowerCase() : null;
    const fullName =
      typeof p.full_name === "string" && p.full_name.trim() ? p.full_name.trim() : null;
    const userProfileId =
      typeof p.user_profile_id === "string" && p.user_profile_id.trim()
        ? p.user_profile_id.trim()
        : null;
    const amount =
      typeof p.amount_cents === "number" && Number.isFinite(p.amount_cents)
        ? Math.round(p.amount_cents)
        : Number.NaN;

    if (!email && !userProfileId) {
      return jsonResponse(
        { error: `Payer #${i + 1} needs an email or user_profile_id` },
        400,
      );
    }
    if (!Number.isFinite(amount) || amount < 0) {
      return jsonResponse(
        { error: `Payer #${i + 1} has an invalid amount_cents` },
        400,
      );
    }

    runningTotal += amount;
    normalizedPayers.push({
      payer_email: email,
      payer_full_name: fullName,
      payer_user_profile_id: userProfileId,
      amount_cents: amount,
    });
  }

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
      normalizedPayers.map((p) => ({
        reservation_id: reservationId,
        payer_email: p.payer_email,
        payer_full_name: p.payer_full_name,
        payer_user_profile_id: p.payer_user_profile_id,
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
