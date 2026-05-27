import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { Resend } from "npm:resend@4.0.0";
import twilio from "npm:twilio@5.0.0";

import { isPhoneOptedOut } from "./sms.ts";
import { formatCents } from "./money.ts";

export type ReservationNotificationChannel = "email" | "sms" | "both" | null;
export type ReservationNotificationStatus = "sent" | "skipped" | "failed";

export type ChannelResult = {
  status: ReservationNotificationStatus;
  reason?: string;
};

export type ReservationNotificationResult = {
  sms: ChannelResult;
  email: ChannelResult;
  status: ReservationNotificationStatus;
  channel: ReservationNotificationChannel;
};

type SendReservationNotificationParams = {
  supabase: SupabaseClient;
  // null when the caller can't resolve a canonical guest row (e.g. the
  // hold-conversion path of create-public-booking). The SMS + email still
  // fire; only the communication_log insert is skipped, since the FK to
  // guests(id) requires a valid id.
  guestId: string | null;
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

export type ConfirmationBodyArgs = {
  guestName: string;
  restaurantName: string;
  partySize: number;
  reservationDateLabel: string;
  eventLine?: string;
  promoLine?: string;
  confirmationCode: string;
  manageLink?: string | null;
  restaurantPhone?: string | null;
  preorderItems?: Array<{ name: string; quantity: number }> | null;
  depositPaidCents?: number | null;
};

export function buildConfirmationBody(args: ConfirmationBodyArgs): string {
  const guestLabel = args.partySize === 1 ? "guest" : "guests";
  const eventLine = args.eventLine ?? "";
  const promoLine = args.promoLine ?? "";

  const preorderLine = args.preorderItems && args.preorderItems.length > 0
    ? `Pre-ordered: ${
      args.preorderItems
        .map((item) => `${item.quantity}× ${item.name}`)
        .join(", ")
    }\n`
    : "";

  const depositLine = args.depositPaidCents && args.depositPaidCents > 0
    ? `Deposit paid: ${formatCents(args.depositPaidCents)}\n`
    : "";

  const extrasBlock = preorderLine || depositLine
    ? `\n${preorderLine}${depositLine}`
    : "";

  const manageLine = args.manageLink ? `Manage or cancel: ${args.manageLink}\n` : "";
  const phoneLine = args.restaurantPhone
    ? `\nNeed to reach the restaurant directly? Call ${args.restaurantPhone}.`
    : "";

  return (
    `Hi ${args.guestName},\n\n` +
    `Your table at ${args.restaurantName} is booked for ${args.partySize} ${guestLabel} on ${args.reservationDateLabel}.` +
    eventLine +
    promoLine +
    `\n` +
    extrasBlock +
    `\n` +
    `Confirmation code: ${args.confirmationCode}\n` +
    manageLine +
    `\nLost this message? Visit https://cenaiva.com/find-reservation` +
    phoneLine
  );
}

function deriveAggregate(
  sms: ChannelResult,
  email: ChannelResult,
): { status: ReservationNotificationStatus; channel: ReservationNotificationChannel } {
  const smsSent = sms.status === "sent";
  const emailSent = email.status === "sent";
  if (smsSent && emailSent) return { status: "sent", channel: "both" };
  if (smsSent) return { status: "sent", channel: "sms" };
  if (emailSent) return { status: "sent", channel: "email" };

  const smsAttempted = sms.status === "failed";
  const emailAttempted = email.status === "failed";
  if (smsAttempted && emailAttempted) return { status: "failed", channel: "both" };
  if (smsAttempted) return { status: "failed", channel: "sms" };
  if (emailAttempted) return { status: "failed", channel: "email" };

  return { status: "skipped", channel: null };
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

  let smsResult: ChannelResult = { status: "skipped", reason: "no_phone" };
  let emailResult: ChannelResult = { status: "skipped", reason: "no_email" };

  // SMS branch — runs independently of email outcome.
  const smsToPhone = normalizeNorthAmericanPhone(phone);
  if (!smsToPhone) {
    smsResult = { status: "skipped", reason: "no_phone" };
  } else if (!twilioClient || !twilioFromPhone) {
    smsResult = { status: "skipped", reason: smsDisabled ? "sms_disabled" : "twilio_unconfigured" };
  } else if (await isPhoneOptedOut(supabase, smsToPhone)) {
    console.log(
      `[reservation-notifications:${type}] phone opted out, skipping SMS to ${smsToPhone.slice(-4)}`,
    );
    smsResult = { status: "skipped", reason: "opted_out" };
  } else {
    try {
      await twilioClient.messages.create({
        body,
        from: twilioFromPhone,
        to: smsToPhone,
      });
      smsResult = { status: "sent" };
    } catch (err) {
      console.error(`${type} SMS failed`, err);
      smsResult = { status: "failed", reason: err instanceof Error ? err.message : String(err) };
    }
  }

  // Email branch — runs independently of SMS outcome (dual-channel by design).
  if (!email) {
    emailResult = { status: "skipped", reason: "no_email" };
  } else if (!resend) {
    emailResult = { status: "skipped", reason: "resend_unconfigured" };
  } else {
    try {
      await resend.emails.send({
        from: Deno.env.get("RESEND_FROM_EMAIL") ?? "Cenaiva <noreply@cenaiva.com>",
        to: email,
        subject,
        text: body,
      });
      emailResult = { status: "sent" };
    } catch (err) {
      console.error(`${type} email failed`, err);
      emailResult = { status: "failed", reason: err instanceof Error ? err.message : String(err) };
    }
  }

  const { status, channel } = deriveAggregate(smsResult, emailResult);

  // Insert ONE row per send. Skip the log when there's no guest_id to bind
  // to — the FK to guests(id) would reject a null guest_id and the rest of
  // the function (SMS + email) still does its job.
  if (channel && guestId) {
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

  return { sms: smsResult, email: emailResult, status, channel };
}
