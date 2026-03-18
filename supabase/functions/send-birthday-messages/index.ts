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
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

function verifyCronSecret(req: Request): boolean {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret) return true;
  return req.headers.get("x-cron-secret") === secret;
}

async function sendBirthdayMessage(
  guest: { full_name: string; email: string | null; phone: string | null; email_opt_in?: boolean; sms_opt_in?: boolean },
  restaurant: { name: string },
  resend: Resend | null,
  twilioClient: ReturnType<typeof twilio> | null,
  fromPhone: string | null
): Promise<{ sms: boolean; email: boolean }> {
  const sent = { sms: false, email: false };
  const firstName = guest.full_name?.split(" ")[0] || "there";

  if (guest.email_opt_in !== false && guest.email && resend) {
    try {
      await resend.emails.send({
        from: "Seatly <noreply@seatly.app>",
        to: guest.email,
        subject: `Happy Birthday from ${restaurant.name}!`,
        text: `Hi ${firstName}, Happy Birthday from the team at ${restaurant.name}! We hope you have a wonderful day. We'd love to celebrate with you soon — book a table when you're ready!`,
      });
      sent.email = true;
    } catch (_) {}
  }

  if (guest.sms_opt_in !== false && guest.phone && twilioClient && fromPhone) {
    try {
      await twilioClient.messages.create({
        body: `Happy Birthday ${firstName}! From ${restaurant.name}. We hope to see you soon!`,
        from: fromPhone,
        to: guest.phone,
      });
      sent.sms = true;
    } catch (_) {}
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
    const today = new Date().toISOString().slice(5, 10);
    const { data: guests } = await supabaseAdmin
      .from("guests")
      .select("id, full_name, email, phone, restaurant_id, email_opt_in, sms_opt_in, birthday")
      .eq("is_blocked", false)
      .not("birthday", "is", null);
    const birthdayGuests = (guests || []).filter(
      (g) => g.birthday && (g.birthday as string).slice(5, 10) === today
    );
    if (!birthdayGuests.length) {
      return new Response(JSON.stringify({ ok: true, sent: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resendKey = Deno.env.get("RESEND_API_KEY");
    const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const twilioToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    const fromPhone = Deno.env.get("TWILIO_PHONE_NUMBER");
    const resend = resendKey ? new Resend(resendKey) : null;
    const twilioClient =
      twilioSid && twilioToken ? twilio(twilioSid, twilioToken) : null;

    const restaurantIds = [...new Set(birthdayGuests.map((g) => g.restaurant_id))];
    const { data: restaurants } = await supabaseAdmin
      .from("restaurants")
      .select("id, name")
      .in("id", restaurantIds);
    const restMap = new Map((restaurants || []).map((r) => [r.id, r]));

    let sent = 0;
    for (const g of birthdayGuests) {
      const rest = restMap.get(g.restaurant_id);
      if (!rest) continue;
      const result = await sendBirthdayMessage(g, rest, resend, twilioClient, fromPhone);
      if (result.sms || result.email) {
        await supabaseAdmin.from("communication_log").insert({
          guest_id: g.id,
          restaurant_id: g.restaurant_id,
          channel: result.sms ? "sms" : "email",
          type: "birthday",
          body: `Birthday message sent`,
          status: "sent",
          sent_at: new Date().toISOString(),
        });
        sent++;
      }
    }

    return new Response(JSON.stringify({ ok: true, sent }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
