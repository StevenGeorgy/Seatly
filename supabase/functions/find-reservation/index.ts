// find-reservation: guest-friendly recovery flow for diners who lost
// their confirmation email/SMS. Two-path lookup:
//
//   1. lookup_type="code": user has their SEAT-XXXX confirmation code
//      → returns { ok: true, found: true, slug, code } so the client
//      can navigate straight to /{slug}?confirmation={code} where
//      ManageBookingView mounts. Returns { ok: true, found: false }
//      if no match.
//
//   2. lookup_type="contact": user lost the code, has email + last
//      name. Match on lowercased email + case-insensitive last-name
//      suffix. ALWAYS returns { ok: true } — never reveals whether
//      the lookup matched. On match, fire-and-forget re-sends the
//      original confirmation message (email + SMS if phone on file).
//
// Anon-callable. Rate limits are the only thing standing between this
// surface and a brute-force probe:
//   - code path:    10 / IP / hour
//   - contact path:  5 / IP / hour (stricter — discovery surface)
//
// Pattern mirrors `dispatch-deposit-invites`: service-role Supabase
// client internally, Resend for email, Twilio for SMS.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Resend } from "npm:resend@4.0.0";
import twilio from "npm:twilio@5.0.0";

import { enforceRateLimit, rateLimitIdentifier, RateLimitError } from "../_shared/rate-limit.ts";
import { isPhoneOptedOut } from "../_shared/sms.ts";
import { parseJsonBody } from "../_shared/validation/parse.ts";
import { FindReservationSchema } from "../_shared/validation/public.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Payload = {
  lookup_type?: unknown;
  code?: unknown;
  email?: unknown;
  last_name?: unknown;
};

type ReservationRow = {
  id: string;
  restaurant_id: string;
  confirmation_code: string | null;
  reserved_at: string;
  party_size: number;
  guest_full_name: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  special_request: string | null;
  status: string | null;
  restaurants: {
    name: string | null;
    slug: string | null;
    timezone: string | null;
    phone: string | null;
  } | null;
};

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatReservationDate(iso: string, tz: string | null): string {
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: tz ?? "America/Toronto",
  }).format(new Date(iso));
}

function normalizeNorthAmericanPhone(phone: string | null): string | null {
  if (!phone) return null;
  if (phone.trim().startsWith("+")) return phone.trim();
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return phone.trim();
}

function normalizeCode(raw: string): { primary: string; alternate: string } {
  // Strip whitespace, uppercase. Accept both "SEAT-A8B2" and "A8B2".
  // If the user pasted "SEAT-A8B2", we try that first then "A8B2" as a
  // fallback (and vice versa). The DB column stores the canonical
  // string create-public-booking generated: `SEAT-${4 base36 chars}`.
  const cleaned = raw.replace(/\s+/g, "").toUpperCase();
  if (cleaned.startsWith("SEAT-")) {
    return { primary: cleaned, alternate: cleaned.slice(5) };
  }
  return { primary: `SEAT-${cleaned}`, alternate: cleaned };
}

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

async function lookupByCode(code: string): Promise<ReservationRow | null> {
  const { primary, alternate } = normalizeCode(code);
  const select =
    "id, restaurant_id, confirmation_code, reserved_at, party_size, guest_full_name, guest_email, guest_phone, special_request, status, restaurants!inner(name, slug, timezone, phone)";
  const tryCode = async (c: string) => {
    const { data, error } = await supabaseAdmin
      .from("reservations")
      .select(select)
      .ilike("confirmation_code", c)
      .gt("reserved_at", new Date().toISOString())
      .in("status", ["confirmed", "pending_payment"])
      .order("reserved_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) return null;
    return (data as unknown as ReservationRow | null) ?? null;
  };
  return (await tryCode(primary)) ?? (await tryCode(alternate));
}

async function lookupByContact(email: string, lastName: string): Promise<ReservationRow | null> {
  // Email is normalized lowercase at write time (see create-public-booking
  // line ~135). Match case-insensitively to be safe. Last name: ends-with
  // match on guest_full_name — most users type "John Smith" so "smith"
  // matches the trailing word case-insensitively.
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedLast = lastName.trim();
  if (!normalizedEmail || !normalizedLast) return null;
  // Escape any wildcards in the surname before using ilike.
  const safeLast = normalizedLast.replace(/[\\%_]/g, "\\$&");
  const select =
    "id, restaurant_id, confirmation_code, reserved_at, party_size, guest_full_name, guest_email, guest_phone, special_request, status, restaurants!inner(name, slug, timezone, phone)";
  const { data, error } = await supabaseAdmin
    .from("reservations")
    .select(select)
    .eq("guest_email", normalizedEmail)
    .ilike("guest_full_name", `% ${safeLast}`)
    .gt("reserved_at", new Date().toISOString())
    .in("status", ["confirmed", "pending_payment"])
    .order("reserved_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return (data as unknown as ReservationRow | null) ?? null;
}

async function resendConfirmation(row: ReservationRow): Promise<void> {
  const restaurantName = row.restaurants?.name?.trim() || "the restaurant";
  const restaurantSlug = row.restaurants?.slug?.trim() ?? null;
  const restaurantPhone = row.restaurants?.phone?.trim() ?? null;
  const tz = row.restaurants?.timezone ?? "America/Toronto";
  const code = row.confirmation_code?.trim() ?? "";
  const reservedLabel = formatReservationDate(row.reserved_at, tz);
  const guestName = row.guest_full_name?.trim() || "there";
  const guestLabel = row.party_size === 1 ? "guest" : "guests";

  const manageLink = restaurantSlug && code
    ? `https://cenaiva.com/${restaurantSlug}?confirmation=${encodeURIComponent(code)}`
    : null;
  const restaurantPhoneLine = restaurantPhone
    ? `\nNeed to reach the restaurant directly? Call ${restaurantPhone}.`
    : "";

  const subject = `Your reservation at ${restaurantName}`;
  const body =
    `Hi ${guestName},\n\n` +
    `Your table at ${restaurantName} is booked for ${row.party_size} ${guestLabel} on ${reservedLabel}.\n\n` +
    `Confirmation code: ${code}\n` +
    (manageLink ? `Manage or cancel: ${manageLink}\n` : "") +
    `\nLost this message? Visit https://cenaiva.com/find-reservation` +
    restaurantPhoneLine;

  // SMS first if we have a phone number — same priority as the
  // original confirmation flow in create-public-booking.
  const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const twilioToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const twilioFromPhone = Deno.env.get("TWILIO_PHONE_NUMBER");
  const twilioClient = twilioSid && twilioToken ? twilio(twilioSid, twilioToken) : null;
  const smsToPhone = normalizeNorthAmericanPhone(row.guest_phone);
  if (smsToPhone && twilioClient && twilioFromPhone) {
    if (await isPhoneOptedOut(supabaseAdmin, smsToPhone)) {
      console.log(
        `[find-reservation] phone opted out, skipping SMS to ${smsToPhone.slice(-4)}`,
      );
    } else {
      try {
        await twilioClient.messages.create({
          body,
          from: twilioFromPhone,
          to: smsToPhone,
        });
      } catch (err) {
        console.warn(
          "[find-reservation] sms resend failed:",
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  // Always also send the email so the diner has a written copy.
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const resend = resendKey ? new Resend(resendKey) : null;
  const fromAddress =
    Deno.env.get("RESEND_FROM_EMAIL") ?? "Cenaiva <noreply@cenaiva.com>";
  if (row.guest_email && resend) {
    try {
      const { error } = await resend.emails.send({
        from: fromAddress,
        to: row.guest_email,
        subject,
        text: body,
      });
      if (error) {
        console.warn("[find-reservation] resend error:", error.message);
      }
    } catch (err) {
      console.warn(
        "[find-reservation] resend threw:",
        err instanceof Error ? err.message : err,
      );
    }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonRes({ error: "POST only" }, 405);

  try {
    const parsed = await parseJsonBody(req, FindReservationSchema, {
      jsonRes: (b, s) => jsonRes(b, s),
    });
    if ("response" in parsed) return parsed.response;
    const payload = parsed.data as Payload;
    const lookupType = asText(payload.lookup_type);

    if (lookupType === "code") {
      const code = asText(payload.code);
      if (!code) return jsonRes({ error: "code is required" }, 400);

      try {
        await enforceRateLimit(
          supabaseAdmin,
          "find-reservation-code",
          rateLimitIdentifier(req),
          { limit: 10, windowSeconds: 3600 },
        );
      } catch (err) {
        if (err instanceof RateLimitError) return jsonRes({ error: err.message }, 429);
        throw err;
      }

      const match = await lookupByCode(code);
      if (!match) return jsonRes({ ok: true, found: false });
      const slug = match.restaurants?.slug?.trim() ?? null;
      const matchedCode = match.confirmation_code?.trim() ?? null;
      if (!slug || !matchedCode) return jsonRes({ ok: true, found: false });
      return jsonRes({ ok: true, found: true, slug, code: matchedCode });
    }

    if (lookupType === "contact") {
      const email = asText(payload.email);
      const lastName = asText(payload.last_name);
      if (!email || !lastName) return jsonRes({ error: "email and last_name are required" }, 400);

      try {
        await enforceRateLimit(
          supabaseAdmin,
          "find-reservation-contact",
          rateLimitIdentifier(req),
          { limit: 5, windowSeconds: 3600 },
        );
      } catch (err) {
        if (err instanceof RateLimitError) return jsonRes({ error: err.message }, 429);
        throw err;
      }

      const match = await lookupByContact(email, lastName);
      // CRITICAL: always return ok regardless of match. Never reveal existence.
      if (match) {
        // Fire-and-forget. We do `await` here because Deno serverless may
        // tear the function down on response — but a Resend/Twilio call is
        // ~300-800ms, well within budget. Errors are swallowed inside
        // resendConfirmation so a Resend outage never throws out.
        try {
          await resendConfirmation(match);
        } catch (err) {
          console.warn(
            "[find-reservation] resend confirmation threw:",
            err instanceof Error ? err.message : err,
          );
        }
      }
      return jsonRes({ ok: true });
    }

    return jsonRes({ error: "lookup_type must be 'code' or 'contact'" }, 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonRes({ error: msg }, 500);
  }
});
