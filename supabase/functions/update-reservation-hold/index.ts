// @ts-nocheck
// update-reservation-hold — Step 1 form submit + Step 2 cart changes.
// Anon-callable. Routes the payload to one or both of:
//
//   update_reservation_hold_diner — attaches name/email/phone + diner
//     overlap re-check (was anonymous at create time).
//   update_reservation_hold_cart  — cart_snapshot + total_amount_cents.
//
// Both can run in the same request when the user types into the form
// AND the cart total has changed. We call diner first because it
// gates on diner-double-book; if that fails, the cart update is
// skipped.
//
// Error mapping:
//   P0010 hold_not_found       → 404
//   P0011 hold_expired         → 409 hold_expired (RPC raises this on
//                                convert; included here for forward-
//                                compat if update ever starts checking
//                                expiry).
//   P0012 hold_not_convertible → 409 hold_expired (treated as
//                                "your hold can no longer accept
//                                edits" — same UX message as expiry).
//   P0006 / 23P01              → 409 diner_double_book

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  enforceRateLimit,
  rateLimitIdentifier,
  RateLimitError,
} from "../_shared/rate-limit.ts";
import { decodeJwtPayload } from "../_shared/jwt.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Payload = {
  hold_id?: unknown;
  full_name?: unknown;
  email?: unknown;
  phone?: unknown;
  cart_snapshot?: unknown;
  total_amount_cents?: unknown;
  special_request?: unknown;
  dietary_notes?: unknown;
  occasion?: unknown;
  seating_preference?: unknown;
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asUuid(value: unknown): string | null {
  const text = asText(value);
  return text && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)
    ? text
    : null;
}

function normalizeEmail(value: unknown): string | null {
  const text = asText(value);
  return text ? text.toLowerCase() : null;
}

function normalizeNorthAmericanPhone(value: unknown): string | null {
  const text = asText(value);
  if (!text) return null;
  if (text.startsWith("+")) return text;
  const digits = text.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return text;
}

function asInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function mapRpcError(rpcError: { code?: string; message?: string }): Response | null {
  const code = rpcError.code;
  if (code === "P0010") {
    return jsonResponse({ error: "hold_not_found" }, 404);
  }
  if (code === "P0011" || code === "P0012") {
    return jsonResponse({ error: "hold_expired" }, 409);
  }
  if (code === "P0006" || code === "23P01") {
    return jsonResponse(
      {
        error: "diner_double_book",
        unavailable_reason: "diner_double_book",
      },
      409,
    );
  }
  return null;
}

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "POST required" }, 405);

  try {
    const payload = (await req.json().catch(() => ({}))) as Payload;

    const holdId = asUuid(payload.hold_id);
    if (!holdId) return jsonResponse({ error: "hold_id is required" }, 400);

    const fullName = asText(payload.full_name);
    const email = normalizeEmail(payload.email);
    const phone = normalizeNorthAmericanPhone(payload.phone);
    const specialRequest = asText(payload.special_request);
    const dietaryNotes = asText(payload.dietary_notes);
    const occasion = asText(payload.occasion);
    const seatingPreference = asText(payload.seating_preference);

    const hasCartSnapshot =
      payload.cart_snapshot !== undefined && payload.cart_snapshot !== null;
    const totalAmountCents = asInteger(payload.total_amount_cents);

    const hasDinerFields =
      Boolean(fullName) ||
      Boolean(email) ||
      Boolean(phone) ||
      Boolean(specialRequest) ||
      Boolean(dietaryNotes) ||
      Boolean(occasion) ||
      Boolean(seatingPreference);
    const hasCartFields = hasCartSnapshot || totalAmountCents !== null;

    if (!hasDinerFields && !hasCartFields) {
      return jsonResponse({ error: "At least one update field is required." }, 400);
    }

    // Resolve logged-in diner (same pattern as create-reservation-hold).
    let userProfileId: string | null = null;
    const authorization = req.headers.get("authorization");
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
    if (token) {
      const decoded = decodeJwtPayload(token);
      const authUserId = typeof decoded?.sub === "string" ? decoded.sub : null;
      if (authUserId) {
        const { data: profile } = await supabaseAdmin
          .from("user_profiles")
          .select("id")
          .eq("auth_user_id", authUserId)
          .maybeSingle();
        userProfileId = profile?.id ?? null;
      }
    }

    try {
      await enforceRateLimit(
        supabaseAdmin,
        "update-reservation-hold:min",
        rateLimitIdentifier(req, userProfileId),
        { limit: 60, windowSeconds: 60 },
      );
    } catch (err) {
      if (err instanceof RateLimitError) {
        return jsonResponse({ error: err.message, unavailable_reason: "rate_limited" }, 429);
      }
      throw err;
    }

    if (hasDinerFields) {
      const { error: dinerError } = await supabaseAdmin.rpc(
        "update_reservation_hold_diner",
        {
          p_hold_id: holdId,
          p_user_profile_id: userProfileId,
          p_guest_full_name: fullName,
          p_guest_email: email,
          p_guest_phone: phone,
          p_special_request: specialRequest,
          p_dietary_notes: dietaryNotes,
          p_occasion: occasion,
          p_seating_preference: seatingPreference,
        },
      );
      if (dinerError) {
        const mapped = mapRpcError(dinerError as { code?: string; message?: string });
        if (mapped) return mapped;
        return jsonResponse(
          { error: `update_reservation_hold_diner: ${dinerError.message}` },
          400,
        );
      }
    }

    if (hasCartFields) {
      const { error: cartError } = await supabaseAdmin.rpc(
        "update_reservation_hold_cart",
        {
          p_hold_id: holdId,
          p_cart_snapshot: hasCartSnapshot ? payload.cart_snapshot : null,
          p_total_amount_cents: totalAmountCents,
        },
      );
      if (cartError) {
        const mapped = mapRpcError(cartError as { code?: string; message?: string });
        if (mapped) return mapped;
        return jsonResponse(
          { error: `update_reservation_hold_cart: ${cartError.message}` },
          400,
        );
      }
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
