// confirm-deposit-stub: STRIPE STUB - replace once Stripe is wired.
//
// Marks a reservation_deposit_payments row as 'charged' to simulate a successful
// Stripe payment. The settle trigger on the table flips the parent reservation
// to 'confirmed' once every row for that reservation is 'charged'.
//
// Real Stripe flow will replace this with a webhook handler that listens for
// payment_intent.succeeded events.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

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

type Payload = {
  payment_id?: unknown;
  outcome?: unknown; // 'charged' (default) | 'failed' for testing
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const STUB_MODE = (Deno.env.get("DEPOSIT_STRIPE_STUB_MODE") ?? "true").toLowerCase() !== "false";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "POST only" }, 405);

  if (!STUB_MODE) {
    return jsonResponse(
      {
        error: "Deposit collection is not yet enabled. Stripe wiring is required.",
      },
      503,
    );
  }

  let payload: Payload;
  try {
    payload = (await req.json()) as Payload;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const paymentId =
    typeof payload.payment_id === "string" && payload.payment_id.trim()
      ? payload.payment_id.trim()
      : null;
  if (!paymentId) {
    return jsonResponse({ error: "payment_id is required" }, 400);
  }

  const outcome =
    payload.outcome === "failed" ? "failed" : "charged";

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    await enforceRateLimit(
      supabase,
      "confirm-deposit-stub",
      rateLimitIdentifier(req, paymentId),
      { limit: 20, windowSeconds: 60 },
    );
  } catch (err) {
    if (err instanceof RateLimitError) {
      return jsonResponse({ error: err.message }, 429);
    }
    throw err;
  }

  const { data: existing, error: lookupError } = await supabase
    .from("reservation_deposit_payments")
    .select("id, reservation_id, status, amount_cents")
    .eq("id", paymentId)
    .single();

  if (lookupError || !existing) {
    return jsonResponse({ error: "Payment not found" }, 404);
  }

  if (existing.status === "charged") {
    return jsonResponse({ ok: true, payment_id: paymentId, status: "charged", already: true });
  }

  if (existing.status === "refunded") {
    return jsonResponse({ error: "Payment already refunded" }, 409);
  }

  const { error: updateError } = await supabase
    .from("reservation_deposit_payments")
    .update({
      status: outcome,
      paid_at: outcome === "charged" ? new Date().toISOString() : null,
      // STRIPE STUB - real PaymentIntent id goes here when wired.
      stripe_payment_intent_id: `stub_${paymentId.slice(0, 8)}`,
    })
    .eq("id", paymentId);

  if (updateError) {
    return jsonResponse({ error: updateError.message }, 500);
  }

  // Read reservation status (the trigger will have flipped it if all rows are charged).
  const { data: reservation } = await supabase
    .from("reservations")
    .select("id, status, deposit_status")
    .eq("id", existing.reservation_id)
    .single();

  return jsonResponse({
    ok: true,
    payment_id: paymentId,
    payment_status: outcome,
    reservation_status: reservation?.status ?? null,
    deposit_status: reservation?.deposit_status ?? null,
  });
});
