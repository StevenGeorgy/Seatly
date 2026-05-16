import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Resend } from "npm:resend@4.0.0";
import twilio from "npm:twilio@5.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

type Kind = "24h" | "2h";

type Reservation = {
  id: string;
  restaurant_id: string;
  guest_id: string | null;
  reserved_at: string;
  confirmation_code: string | null;
  guest_full_name: string | null;
  guest_phone: string | null;
  guest_email: string | null;
  reminder_sent_24h: boolean;
  reminder_sent_2h: boolean;
};

type Guest = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  email_opt_in: boolean | null;
  sms_opt_in: boolean | null;
};

type Restaurant = {
  id: string;
  name: string;
  slug: string | null;
  timezone: string | null;
};

function verifyCronSecret(req: Request): boolean {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret) return true;
  return req.headers.get("x-cron-secret") === secret;
}

function formatTime(reservedAt: string, timezone: string | null): string {
  const date = new Date(reservedAt);
  try {
    return date.toLocaleString("en-US", {
      timeZone: timezone ?? "America/Toronto",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch (_) {
    return date.toLocaleString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  }
}

function smsBody(
  kind: Kind,
  firstName: string,
  restName: string,
  time: string,
  code: string | null,
): string {
  if (kind === "24h") {
    const codePart = code ? ` Code: ${code}.` : "";
    return `Hi ${firstName}, this is a reminder of your reservation at ${restName} tomorrow at ${time}.${codePart} Reply CANCEL to cancel.`;
  }
  return `Hi ${firstName}, your reservation at ${restName} is in 2 hours (${time}). See you soon!`;
}

function emailSubject(kind: Kind, restName: string): string {
  return kind === "24h"
    ? `Reminder: your reservation at ${restName} tomorrow`
    : `Your reservation at ${restName} is in 2 hours`;
}

function emailBody(
  kind: Kind,
  firstName: string,
  restName: string,
  time: string,
  code: string | null,
  slug: string | null,
): string {
  const lead = kind === "24h"
    ? `Hi ${firstName},\n\nJust a quick reminder that we have a table reserved for you at ${restName} tomorrow at ${time}.`
    : `Hi ${firstName},\n\nYour reservation at ${restName} is in 2 hours, at ${time}. See you soon!`;
  const codeLine = code ? `\n\nConfirmation code: ${code}` : "";
  const link = slug
    ? `\n\nManage your booking: https://cenaiva.com/${slug}${code ? `?confirmation=${code}` : ""}`
    : "";
  return `${lead}${codeLine}${link}\n\nThe ${restName} team`;
}

async function sendReminder(
  reservation: Reservation,
  kind: Kind,
  restaurant: Restaurant,
  guest: Guest | null,
  resend: Resend | null,
  twilioClient: ReturnType<typeof twilio> | null,
  fromPhone: string | null,
): Promise<{ sent: boolean; channel: "sms" | "email" | null }> {
  // Prefer linked-guest contact info; fall back to guest-checkout fields stored on the reservation.
  const phone = guest?.phone ?? reservation.guest_phone;
  const email = guest?.email ?? reservation.guest_email;
  const fullName = guest?.full_name ?? reservation.guest_full_name ?? "";
  const firstName = fullName.split(" ")[0] || "there";
  // null = opt-in. Only false explicitly opts out. Guest-checkouts have no guest record so default opt-in.
  const smsOptIn = guest?.sms_opt_in !== false;
  const emailOptIn = guest?.email_opt_in !== false;
  const time = formatTime(reservation.reserved_at, restaurant.timezone);

  // SMS first
  if (smsOptIn && phone && twilioClient && fromPhone) {
    try {
      await twilioClient.messages.create({
        body: smsBody(kind, firstName, restaurant.name, time, reservation.confirmation_code),
        from: fromPhone,
        to: phone,
      });
      return { sent: true, channel: "sms" };
    } catch (_) {
      // fall through to email
    }
  }

  // Email fallback
  if (emailOptIn && email && resend) {
    try {
      await resend.emails.send({
        from: Deno.env.get("RESEND_FROM_EMAIL") ?? "Cenaiva <noreply@cenaiva.com>",
        to: email,
        subject: emailSubject(kind, restaurant.name),
        text: emailBody(
          kind,
          firstName,
          restaurant.name,
          time,
          reservation.confirmation_code,
          restaurant.slug,
        ),
      });
      return { sent: true, channel: "email" };
    } catch (_) {
      return { sent: false, channel: null };
    }
  }

  return { sent: false, channel: null };
}

async function processBatch(
  kind: Kind,
  resend: Resend | null,
  twilioClient: ReturnType<typeof twilio> | null,
  fromPhone: string | null,
): Promise<number> {
  const flagColumn = kind === "24h" ? "reminder_sent_24h" : "reminder_sent_2h";
  const lowerMs = (kind === "24h" ? 23 * 60 + 55 : 1 * 60 + 55) * 60_000;
  const upperMs = (kind === "24h" ? 24 * 60 + 5 : 2 * 60 + 5) * 60_000;
  const now = Date.now();
  const lower = new Date(now + lowerMs).toISOString();
  const upper = new Date(now + upperMs).toISOString();

  const { data: reservations, error } = await supabaseAdmin
    .from("reservations")
    .select(
      "id, restaurant_id, guest_id, reserved_at, confirmation_code, guest_full_name, guest_phone, guest_email, reminder_sent_24h, reminder_sent_2h",
    )
    .eq(flagColumn, false)
    .in("status", ["confirmed", "pending"])
    .gte("reserved_at", lower)
    .lte("reserved_at", upper);

  if (error || !reservations?.length) return 0;

  const restaurantIds = [...new Set(reservations.map((r) => r.restaurant_id))];
  const guestIds = reservations
    .map((r) => r.guest_id)
    .filter((id): id is string => id != null);

  const [restRes, guestRes] = await Promise.all([
    supabaseAdmin
      .from("restaurants")
      .select("id, name, slug, timezone")
      .in("id", restaurantIds),
    guestIds.length
      ? supabaseAdmin
        .from("guests")
        .select("id, full_name, email, phone, email_opt_in, sms_opt_in")
        .in("id", guestIds)
      : Promise.resolve({ data: [] as Guest[] }),
  ]);

  const restMap = new Map(
    ((restRes.data ?? []) as Restaurant[]).map((r) => [r.id, r]),
  );
  const guestMap = new Map(
    ((guestRes.data ?? []) as Guest[]).map((g) => [g.id, g]),
  );

  let sent = 0;
  for (const row of reservations as Reservation[]) {
    const restaurant = restMap.get(row.restaurant_id);
    if (!restaurant) continue;
    const guest = row.guest_id ? guestMap.get(row.guest_id) ?? null : null;

    const result = await sendReminder(
      row,
      kind,
      restaurant,
      guest,
      resend,
      twilioClient,
      fromPhone,
    );
    if (!result.sent) continue;

    // Flip the flag so this row is excluded next tick.
    await supabaseAdmin
      .from("reservations")
      .update({ [flagColumn]: true })
      .eq("id", row.id);

    // communication_log requires guest_id (NOT NULL). Skip log for guest-checkout rows.
    if (row.guest_id) {
      await supabaseAdmin.from("communication_log").insert({
        guest_id: row.guest_id,
        restaurant_id: row.restaurant_id,
        channel: result.channel,
        type: kind === "24h" ? "reservation_reminder_24h" : "reservation_reminder_2h",
        body: `Reservation reminder (${kind}) sent`,
        status: "sent",
        sent_at: new Date().toISOString(),
      });
    }
    sent++;
  }

  return sent;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (!verifyCronSecret(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const twilioToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    const fromPhone = Deno.env.get("TWILIO_PHONE_NUMBER") ?? null;
    const resend = resendKey ? new Resend(resendKey) : null;
    const twilioClient = twilioSid && twilioToken ? twilio(twilioSid, twilioToken) : null;

    const sent24 = await processBatch("24h", resend, twilioClient, fromPhone);
    const sent2 = await processBatch("2h", resend, twilioClient, fromPhone);

    return new Response(
      JSON.stringify({ ok: true, sent_24h: sent24, sent_2h: sent2 }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
