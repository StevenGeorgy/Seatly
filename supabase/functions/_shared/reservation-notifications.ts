import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { Resend } from "npm:resend@4.0.0";
import twilio from "npm:twilio@5.0.0";

export type ReservationNotificationChannel = "email" | "sms" | null;
export type ReservationNotificationStatus = "sent" | "skipped" | "failed";

export type ReservationNotificationResult = {
  status: ReservationNotificationStatus;
  channel: ReservationNotificationChannel;
};

type SendReservationNotificationParams = {
  supabase: SupabaseClient;
  guestId: string;
  restaurantId: string;
  reservationId: string;
  type: "reservation_confirmation" | "reservation_cancellation" | "reservation_modification";
  email: string | null;
  phone: string | null;
  subject: string;
  body: string;
};

export function formatReservationDate(
  date: Date,
  timeZone = "America/Toronto",
): string {
  // en-US for "7:00 PM" not "7:00 p.m." (en-CA), to match the rest of the
  // system's uppercase AM/PM formatting. Audit caught 2026-05-11.
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone,
  }).format(date);
}

function normalizeNorthAmericanPhone(phone: string | null): string | null {
  if (!phone) return null;
  if (phone.trim().startsWith("+")) return phone.trim();
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return phone.trim();
}

export async function sendReservationNotification({
  supabase,
  guestId,
  restaurantId,
  reservationId,
  type,
  email,
  phone,
  subject,
  body,
}: SendReservationNotificationParams): Promise<ReservationNotificationResult> {
  // Kill switch — set CENAIVA_SMS_DISABLED=true in Supabase env to suppress
  // all SMS sends. Useful during automated test runs or incidents (Twilio
  // costs spiking, abuse). Email still sends. User bug 2026-05-12.
  const smsDisabled = Deno.env.get("CENAIVA_SMS_DISABLED") === "true";

  const resendKey = Deno.env.get("RESEND_API_KEY");
  const resend = resendKey ? new Resend(resendKey) : null;
  const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const twilioToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const twilioFromPhone = Deno.env.get("TWILIO_PHONE_NUMBER");
  const twilioClient = !smsDisabled && twilioSid && twilioToken ? twilio(twilioSid, twilioToken) : null;

  let channel: ReservationNotificationChannel = null;
  let status: ReservationNotificationStatus = "skipped";

  const smsToPhone = normalizeNorthAmericanPhone(phone);
  if (smsToPhone && twilioClient && twilioFromPhone) {
    try {
      await twilioClient.messages.create({
        body,
        from: twilioFromPhone,
        to: smsToPhone,
      });
      channel = "sms";
      status = "sent";
    } catch (err) {
      console.error(`${type} SMS failed`, err);
      channel = "sms";
      status = "failed";
    }
  }

  if (status !== "sent" && email && resend) {
    try {
      await resend.emails.send({
        from: Deno.env.get("RESEND_FROM_EMAIL") ?? "Cenaiva <noreply@cenaiva.com>",
        to: email,
        subject,
        text: body,
      });
      channel = "email";
      status = "sent";
    } catch (err) {
      console.error(`${type} email failed`, err);
      channel = "email";
      status = "failed";
    }
  }

  if (channel) {
    const { error } = await supabase.from("communication_log").insert({
      guest_id: guestId,
      restaurant_id: restaurantId,
      channel,
      type,
      subject,
      body,
      status,
      sent_at: status === "sent" ? new Date().toISOString() : null,
      campaign_id: reservationId,
    });

    if (error) {
      console.error(`${type} communication_log insert failed`, error);
    }
  }

  return { status, channel };
}
