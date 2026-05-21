// @ts-nocheck
// twilio-incoming-sms: webhook for inbound SMS from Twilio. Handles
// the CTIA-required opt-out keywords STOP/UNSUBSCRIBE/CANCEL/END/QUIT
// and the re-subscribe keywords START/UNSTOP/YES. Also responds to
// HELP/INFO with a support address.
//
// Auth: Twilio doesn't send a JWT. The HMAC-SHA1 `X-Twilio-Signature`
// header IS the auth — we verify it against TWILIO_AUTH_TOKEN per
// https://www.twilio.com/docs/usage/security#validating-requests
//
// Phone matching mirrors `_shared/sms.ts:normalizePhoneForLookup`:
// look up `user_profiles.phone` by BOTH +E164 and bare 10-digit
// forms. If no matching profile, we still return success TwiML —
// the diner is opting out of a number they may not have on file yet
// (e.g. guest checkouts that haven't completed onboarding).
//
// CORS: this fn is only ever called by Twilio's edge nodes; no
// browser origin involved. We still emit basic headers so manual
// curl testing works.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { normalizePhoneForLookup } from "../_shared/sms.ts";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-twilio-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TWIML_HEADER = `<?xml version="1.0" encoding="UTF-8"?>`;

const SUPPORT_EMAIL = Deno.env.get("CENAIVA_SUPPORT_EMAIL") ?? "support@cenaiva.com";

const STOP_KEYWORDS = new Set([
  "STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT",
]);
const START_KEYWORDS = new Set(["START", "UNSTOP", "YES"]);
const HELP_KEYWORDS = new Set(["HELP", "INFO"]);

function twimlResponse(messageBody: string | null, status = 200): Response {
  const body = messageBody
    ? `${TWIML_HEADER}<Response><Message>${escapeXml(messageBody)}</Message></Response>`
    : `${TWIML_HEADER}<Response/>`;
  return new Response(body, {
    status,
    headers: { ...corsHeaders, "Content-Type": "text/xml; charset=utf-8" },
  });
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function forbidden(): Response {
  return new Response("Forbidden", {
    status: 403,
    headers: { ...corsHeaders, "Content-Type": "text/plain" },
  });
}

// Twilio signature algorithm: HMAC-SHA1(authToken, fullUrl + sortedFormParams).
// `fullUrl` is the URL Twilio POSTed to (including query string).
// `sortedFormParams` is the form fields sorted alphabetically by key,
// concatenated as `key + value` pairs (no separator). The result is
// base64-encoded SHA1.
async function verifyTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signatureHeader: string,
): Promise<boolean> {
  const sortedKeys = Object.keys(params).sort();
  let payload = url;
  for (const key of sortedKeys) {
    payload += key + params[key];
  }

  const encoder = new TextEncoder();
  const keyData = encoder.encode(authToken);
  const dataBuf = encoder.encode(payload);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", cryptoKey, dataBuf);
  const sigBytes = new Uint8Array(sigBuf);
  // base64 encode
  let bin = "";
  for (let i = 0; i < sigBytes.length; i++) bin += String.fromCharCode(sigBytes[i]);
  const computed = btoa(bin);

  // Constant-time compare
  if (computed.length !== signatureHeader.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ signatureHeader.charCodeAt(i);
  }
  return diff === 0;
}

async function setOptOut(phone: string, optOut: boolean): Promise<void> {
  const { e164, digits } = normalizePhoneForLookup(phone);
  const candidates = Array.from(new Set([e164, digits].filter(Boolean))) as string[];
  if (candidates.length === 0) return;
  try {
    const { error } = await supabaseAdmin
      .from("user_profiles")
      .update({ sms_opt_out: optOut })
      .in("phone", candidates);
    if (error) {
      console.warn("[twilio-incoming-sms] update failed:", error.message);
    }
  } catch (err) {
    console.warn("[twilio-incoming-sms] update threw:",
      err instanceof Error ? err.message : err);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response("POST only", { status: 405, headers: corsHeaders });
  }

  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  if (!authToken) {
    console.error("[twilio-incoming-sms] TWILIO_AUTH_TOKEN not set");
    return forbidden();
  }

  const signature = req.headers.get("x-twilio-signature") ?? "";
  if (!signature) return forbidden();

  // Parse form-urlencoded body. We have to read the body once and then
  // verify the signature on the reconstructed params. URL must be the
  // EXACT URL Twilio posted to — including query string and protocol.
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (err) {
    console.warn("[twilio-incoming-sms] form parse failed:",
      err instanceof Error ? err.message : err);
    return forbidden();
  }

  const params: Record<string, string> = {};
  formData.forEach((value, key) => {
    if (typeof value === "string") params[key] = value;
  });

  // Twilio webhook URL: req.url is what Deno saw, which matches Twilio's
  // POST target unless a load balancer rewrote the host. We accept an
  // optional override env so an operator can pin the verification URL
  // (useful when there's a CDN in front).
  const overrideUrl = Deno.env.get("TWILIO_WEBHOOK_PUBLIC_URL");
  const fullUrl = overrideUrl ?? req.url;

  const ok = await verifyTwilioSignature(authToken, fullUrl, params, signature);
  if (!ok) {
    console.warn("[twilio-incoming-sms] signature verification failed");
    return forbidden();
  }

  const fromPhone = (params["From"] ?? "").trim();
  const rawBody = (params["Body"] ?? "").trim();
  const keyword = rawBody.toUpperCase();

  if (!fromPhone) {
    return twimlResponse(null);
  }

  if (STOP_KEYWORDS.has(keyword)) {
    await setOptOut(fromPhone, true);
    return twimlResponse(
      "You're unsubscribed from Cenaiva SMS. Reply START to re-subscribe.",
    );
  }

  if (START_KEYWORDS.has(keyword)) {
    await setOptOut(fromPhone, false);
    return twimlResponse(
      "You're re-subscribed to Cenaiva SMS. Reply STOP to unsubscribe.",
    );
  }

  if (HELP_KEYWORDS.has(keyword)) {
    return twimlResponse(
      `Cenaiva: reservations and reminders. Reply STOP to unsubscribe. Support: ${SUPPORT_EMAIL}`,
    );
  }

  // Any other inbound text — acknowledge with empty TwiML so Twilio
  // doesn't retry. We don't surface chat-style replies on this channel.
  return twimlResponse(null);
});
