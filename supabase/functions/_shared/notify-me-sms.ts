import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import twilio from "npm:twilio@5.0.0";

import { isPhoneOptedOut } from "./sms.ts";

// One row returned by `match_availability_alerts_for_restaurant` /
// `match_availability_alerts_for_event`. Restaurant-variant rows have
// `slot_time` set; event-variant rows have `event_id` + `event_name` set.
// The helper renders the right SMS body for whichever variant is present.
export type FulfilledAlertRow = {
  notification_id: string;
  alert_id: string;
  user_id: string;
  phone: string | null;
  restaurant_id: string;
  restaurant_name: string;
  restaurant_slug: string | null;
  event_id: string | null;
  event_name: string | null;
  slot_date: string; // YYYY-MM-DD
  slot_time: string | null; // HH:MM:SS
  party_size: number;
  route: string;
};

export type NotifyMeSmsResult = {
  sent: number;
  failed: number;
  skipped: number;
};

function normalizeNorthAmericanPhone(phone: string | null): string | null {
  if (!phone) return null;
  if (phone.trim().startsWith("+")) return phone.trim();
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return phone.trim();
}

function formatSlotTime(slot_time: string | null): string {
  if (!slot_time) return "";
  // Postgres returns time as "HH:MM:SS"; render "7:00 PM" style.
  const [h, m] = slot_time.split(":");
  const hour = Number(h);
  const min = Number(m);
  if (Number.isNaN(hour) || Number.isNaN(min)) return slot_time;
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const mm = min.toString().padStart(2, "0");
  return `${h12}:${mm} ${ampm}`;
}

function formatSlotDate(slot_date: string): string {
  // Render "May 14" from a YYYY-MM-DD string. Using UTC parts so we don't
  // shift across the local boundary.
  const [y, m, d] = slot_date.split("-").map(Number);
  if (!y || !m || !d) return slot_date;
  const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${monthNames[m - 1]} ${d}`;
}

function buildSmsBody(row: FulfilledAlertRow, baseUrl: string): string {
  const link = `${baseUrl}${row.route}`;
  const dateLabel = formatSlotDate(row.slot_date);
  if (row.event_id && row.event_name) {
    const seats = row.party_size === 1 ? "1 seat" : `${row.party_size} seats`;
    return `Cenaiva: ${seats} just opened at ${row.event_name} on ${dateLabel}. Book: ${link}`;
  }
  const timeLabel = row.slot_time ? ` at ${formatSlotTime(row.slot_time)}` : "";
  const partyLabel = `party of ${row.party_size}`;
  return `Cenaiva: Table just opened at ${row.restaurant_name} on ${dateLabel}${timeLabel} for ${partyLabel}. Book: ${link}`;
}

// Dispatch SMS for every fulfilled Notify Me alert returned by the match
// RPCs. Best-effort: in-app notification was already created by the RPC,
// so a Twilio outage or kill-switch never blocks the user-facing edge
// function response. Logs each attempt to `communication_log` so the
// owner can audit deliveries.
//
// Honors `CENAIVA_SMS_DISABLED=true` short-circuit (same pattern as
// _shared/reservation-notifications.ts) and accepts a Supabase client
// for the communication_log insert.
export async function sendNotifyMeSms(
  supabase: SupabaseClient,
  rows: FulfilledAlertRow[],
): Promise<NotifyMeSmsResult> {
  let sent = 0, failed = 0, skipped = 0;
  if (rows.length === 0) return { sent, failed, skipped };

  const smsDisabled = Deno.env.get("CENAIVA_SMS_DISABLED") === "true";
  const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const twilioToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const twilioFromPhone = Deno.env.get("TWILIO_PHONE_NUMBER");
  const baseUrl = Deno.env.get("CENAIVA_PUBLIC_URL") ?? "https://cenaiva.com";

  const twilioClient = !smsDisabled && twilioSid && twilioToken
    ? twilio(twilioSid, twilioToken)
    : null;

  const results = await Promise.allSettled(
    rows.map(async (row) => {
      const to = normalizeNorthAmericanPhone(row.phone);
      const body = buildSmsBody(row, baseUrl);

      if (!to || !twilioClient || !twilioFromPhone) {
        // Either no phone on file, kill-switch on, or Twilio creds missing.
        await supabase.from("communication_log").insert({
          guest_id: null,
          restaurant_id: row.restaurant_id,
          channel: "sms",
          type: "slot_opened",
          subject: row.event_name ?? row.restaurant_name,
          body,
          status: "skipped",
          sent_at: null,
          campaign_id: row.alert_id,
        });
        skipped += 1;
        return;
      }

      if (await isPhoneOptedOut(supabase, to)) {
        console.log(`[notify-me-sms] phone opted out, skipping SMS to ${to.slice(-4)}`);
        await supabase.from("communication_log").insert({
          guest_id: null,
          restaurant_id: row.restaurant_id,
          channel: "sms",
          type: "slot_opened",
          subject: row.event_name ?? row.restaurant_name,
          body,
          status: "skipped",
          sent_at: null,
          campaign_id: row.alert_id,
        });
        skipped += 1;
        return;
      }

      try {
        await twilioClient.messages.create({ body, from: twilioFromPhone, to });
        sent += 1;
        await supabase.from("communication_log").insert({
          guest_id: null,
          restaurant_id: row.restaurant_id,
          channel: "sms",
          type: "slot_opened",
          subject: row.event_name ?? row.restaurant_name,
          body,
          status: "sent",
          sent_at: new Date().toISOString(),
          campaign_id: row.alert_id,
        });
      } catch (err) {
        failed += 1;
        console.error("[notify-me-sms] Twilio send failed:", err);
        await supabase.from("communication_log").insert({
          guest_id: null,
          restaurant_id: row.restaurant_id,
          channel: "sms",
          type: "slot_opened",
          subject: row.event_name ?? row.restaurant_name,
          body,
          status: "failed",
          sent_at: null,
          campaign_id: row.alert_id,
        });
      }
    }),
  );

  // Catch any promise that itself rejected (shouldn't happen since each
  // task swallows its own errors, but defensive).
  for (const r of results) {
    if (r.status === "rejected") {
      console.error("[notify-me-sms] task rejected:", r.reason);
    }
  }

  return { sent, failed, skipped };
}
