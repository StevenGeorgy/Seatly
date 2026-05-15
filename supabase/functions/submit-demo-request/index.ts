import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { enforceRateLimit, rateLimitIdentifier, RateLimitError } from "../_shared/rate-limit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type DemoRequestPayload = {
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  restaurant_name?: unknown;
  message?: unknown;
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function asTrimmedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Server configuration error" }, 500);
  }
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  try {
    await enforceRateLimit(adminClient, "submit-demo-request", rateLimitIdentifier(req), {
      limit: 5,
      windowSeconds: 60 * 60,
    });
  } catch (error) {
    if (error instanceof RateLimitError) {
      return jsonResponse({ error: error.message }, 429);
    }
    throw error;
  }

  let payload: DemoRequestPayload;
  try {
    payload = (await req.json()) as DemoRequestPayload;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const name = asTrimmedString(payload.name, 200);
  const email = asTrimmedString(payload.email, 320);
  const phone = asTrimmedString(payload.phone, 30);
  const restaurantName = asTrimmedString(payload.restaurant_name, 200);
  const message = asTrimmedString(payload.message, 1000);

  if (!name) return jsonResponse({ error: "Name is required" }, 400);
  if (!email) return jsonResponse({ error: "Email is required" }, 400);
  if (!EMAIL_RE.test(email)) {
    return jsonResponse({ error: "Please enter a valid email address" }, 400);
  }
  if (phone && phone.length < 7) {
    return jsonResponse({ error: "Phone number looks too short" }, 400);
  }

  const { data, error } = await adminClient
    .from("demo_requests")
    .insert({
      name,
      email,
      phone,
      restaurant_name: restaurantName,
      message,
    })
    .select("id")
    .single();

  if (error) {
    // PostgREST returns 42P01 (undefined_table) when the migration hasn't run yet.
    if (error.code === "42P01") {
      return jsonResponse(
        { error: "Demo requests aren't accepting submissions yet. Please email hello@cenaiva.com." },
        503,
      );
    }
    return jsonResponse({ error: "Failed to submit request" }, 500);
  }

  return jsonResponse({ id: data.id }, 200);
});
