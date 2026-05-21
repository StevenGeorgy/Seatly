// update-billing-details: in-app self-service for the legal name, billing
// email, address, and tax ID on the restaurant's Stripe customer.
// Replaces the "Open billing portal" redirect with a native form.
//
// Strategy: Stripe is the source of truth. We:
//   1) Update the customer (name, email, address)
//   2) Reconcile tax IDs (Stripe stores them as separate objects):
//      - List current tax IDs on the customer
//      - Delete any that no longer match what the owner submitted
//      - Create the submitted one if it's not already there
//   3) Mirror everything to the `restaurants` row for fast display
//
// Auth: owner role required.
//
// Payload: { restaurant_id, legal_name?, billing_email?, address: {...}?,
//            tax_id?: { type: string, value: string } | null }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { enforceRateLimit, rateLimitIdentifier, RateLimitError } from "../_shared/rate-limit.ts";
import { parseJsonBody } from "../_shared/validation/parse.ts";
import { UpdateBillingDetailsSchema } from "../_shared/validation/observability.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface AddressPayload {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  province?: string | null;
  postal_code?: string | null;
  country?: string | null;
}

interface TaxIdPayload {
  type: string;
  value: string;
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

async function ownerOfRestaurant(authUserId: string, restaurantId: string): Promise<boolean> {
  const { data: profile } = await supabaseAdmin
    .from("user_profiles")
    .select("id")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  if (!profile) return false;
  const { data: role } = await supabaseAdmin
    .from("user_restaurant_roles")
    .select("role")
    .eq("user_id", (profile as { id: string }).id)
    .eq("restaurant_id", restaurantId)
    .eq("role", "owner")
    .maybeSingle();
  return Boolean(role);
}

function trimToNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

function parseAddress(input: unknown): AddressPayload | null {
  if (!input || typeof input !== "object") return null;
  const a = input as Record<string, unknown>;
  return {
    line1: trimToNull(a.line1),
    line2: trimToNull(a.line2),
    city: trimToNull(a.city),
    province: trimToNull(a.province),
    postal_code: trimToNull(a.postal_code),
    country: trimToNull(a.country) ?? "CA",
  };
}

function parseTaxId(input: unknown): TaxIdPayload | null | undefined {
  if (input === null) return null; // explicit clear
  if (input === undefined) return undefined; // no change requested
  if (typeof input !== "object") return undefined;
  const t = input as Record<string, unknown>;
  const type = trimToNull(t.type);
  const value = trimToNull(t.value);
  if (!type || !value) return null; // treated as "clear the tax ID"
  return { type, value };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonRes({ error: "POST only" }, 405);

  try {
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) return jsonRes({ error: "Missing authorization token" }, 401);

    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) return jsonRes({ error: "Invalid or expired session" }, 401);

    const parsed = await parseJsonBody(req, UpdateBillingDetailsSchema, { jsonRes });
    if ("response" in parsed) return parsed.response;
    const payload = parsed.data;
    const restaurantId = payload.restaurant_id;

    try {
      await enforceRateLimit(
        supabaseAdmin,
        "update-billing-details",
        rateLimitIdentifier(req, user.id),
        { limit: 10, windowSeconds: 60 },
      );
    } catch (err) {
      if (err instanceof RateLimitError) return jsonRes({ error: err.message }, 429);
      throw err;
    }

    const isOwner = await ownerOfRestaurant(user.id, restaurantId);
    if (!isOwner) return jsonRes({ error: "Not authorized for this restaurant" }, 403);

    const legalName = trimToNull(payload.legal_name);
    const billingEmail = trimToNull(payload.billing_email);
    const address = parseAddress(payload.address);
    const taxId = parseTaxId(payload.tax_id);

    const { data: rest } = await supabaseAdmin
      .from("restaurants")
      .select("id, name, stripe_customer_id")
      .eq("id", restaurantId)
      .maybeSingle();
    if (!rest) return jsonRes({ error: "Restaurant not found" }, 404);
    const row = rest as {
      id: string;
      name: string | null;
      stripe_customer_id: string | null;
    };
    if (!row.stripe_customer_id) {
      return jsonRes({ error: "Restaurant has no Stripe customer." }, 400);
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) return jsonRes({ error: "Stripe not configured on server" }, 500);
    const { default: Stripe } = await import("npm:stripe@17");
    const stripe = new Stripe(stripeKey, { apiVersion: "2024-11-20.acacia" });

    // 1) Update customer (name + email + address).
    const customerUpdate: Record<string, unknown> = {};
    if (legalName !== null) customerUpdate.name = legalName;
    if (billingEmail !== null) customerUpdate.email = billingEmail;
    if (address) {
      // Stripe address shape uses `state` not `province`.
      customerUpdate.address = {
        line1: address.line1 ?? "",
        line2: address.line2 ?? null,
        city: address.city ?? "",
        state: address.province ?? "",
        postal_code: address.postal_code ?? "",
        country: address.country ?? "CA",
      };
    }
    if (Object.keys(customerUpdate).length > 0) {
      try {
        await stripe.customers.update(row.stripe_customer_id, customerUpdate);
      } catch (err) {
        const e = err as { message?: string; code?: string };
        return jsonRes({
          error: `Stripe customer update failed: ${e.message ?? String(err)}`,
          stripe_code: e.code,
        }, 400);
      }
    }

    // 2) Reconcile tax IDs.
    if (taxId !== undefined) {
      // List existing
      let existingIds: Array<{ id: string; type: string; value: string }> = [];
      try {
        const list = await stripe.customers.listTaxIds(row.stripe_customer_id, { limit: 10 });
        existingIds = (list.data ?? []).map((t) => ({
          id: t.id,
          type: t.type as string,
          value: t.value as string,
        }));
      } catch (err) {
        console.error("[update-billing-details] listTaxIds failed", err);
      }

      // Delete any that don't match the submitted one (or all if cleared).
      for (const existing of existingIds) {
        const shouldKeep =
          taxId !== null &&
          taxId.type === existing.type &&
          taxId.value === existing.value;
        if (shouldKeep) continue;
        try {
          await stripe.customers.deleteTaxId(row.stripe_customer_id, existing.id);
        } catch (err) {
          console.warn("[update-billing-details] deleteTaxId failed", err);
        }
      }

      // Create the submitted one if it's not already there.
      if (taxId !== null) {
        const alreadyExists = existingIds.some(
          (e) => e.type === taxId.type && e.value === taxId.value,
        );
        if (!alreadyExists) {
          try {
            // deno-lint-ignore no-explicit-any
            await stripe.customers.createTaxId(row.stripe_customer_id, {
              type: taxId.type as any,
              value: taxId.value,
            });
          } catch (err) {
            const e = err as { message?: string; code?: string };
            return jsonRes({
              error: `Stripe tax ID create failed: ${e.message ?? String(err)}`,
              stripe_code: e.code,
            }, 400);
          }
        }
      }
    }

    // 3) Mirror to local DB.
    const dbPatch: Record<string, unknown> = {};
    if (legalName !== null) dbPatch.billing_legal_name = legalName;
    if (billingEmail !== null) dbPatch.billing_email = billingEmail;
    if (address) {
      dbPatch.billing_address_line1 = address.line1;
      dbPatch.billing_address_line2 = address.line2;
      dbPatch.billing_address_city = address.city;
      dbPatch.billing_address_province = address.province;
      dbPatch.billing_address_postal_code = address.postal_code;
      dbPatch.billing_address_country = address.country ?? "CA";
    }
    if (taxId === null) {
      dbPatch.billing_tax_id_type = null;
      dbPatch.billing_tax_id_value = null;
    } else if (taxId !== undefined) {
      dbPatch.billing_tax_id_type = taxId.type;
      dbPatch.billing_tax_id_value = taxId.value;
    }

    if (Object.keys(dbPatch).length > 0) {
      const { error: updateErr } = await supabaseAdmin
        .from("restaurants")
        .update(dbPatch)
        .eq("id", restaurantId);
      if (updateErr) {
        console.error("[update-billing-details] DB mirror failed", updateErr);
      }
    }

    return jsonRes({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[update-billing-details] unhandled error:", msg);
    return jsonRes({ error: msg }, 500);
  }
});
