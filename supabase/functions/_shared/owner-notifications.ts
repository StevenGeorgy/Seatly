// @ts-nocheck
// owner-notifications: Resend-based email helper for lifecycle events that
// notify the restaurant owner (live, deletion scheduled, restored, payment
// failed/recovered, trial ending). Idempotency is enforced by querying
// restaurant_notification_log before sending — if a 'sent' row of the same
// type exists within the configured window, we skip and return.
//
// Single source of truth for these emails. Mirrors the transport pattern in
// reservation-notifications.ts (Resend only — owner emails do not currently
// have an SMS channel; phone numbers on `restaurants` are public-facing not
// for transactional comms).

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { Resend } from "npm:resend@4.0.0";

export type OwnerNotificationType =
  | "restaurant_live"
  | "restaurant_deletion_scheduled"
  | "restaurant_restored"
  | "payment_failed"
  | "payment_recovered"
  | "trial_ending_soon"
  | "payment_received"
  | "subscription_cancelled"
  | "subscription_paused"
  | "subscription_resumed";

export interface SendOwnerNotificationOpts {
  supabase: SupabaseClient;
  restaurant_id: string;
  type: OwnerNotificationType;
  context: Record<string, unknown>;
  idempotent_within_seconds?: number;
}

export interface SendOwnerNotificationResult {
  status: "sent" | "skipped" | "failed";
  message?: string;
}

interface OwnerContact {
  email: string | null;
  name: string | null;
  restaurantName: string | null;
}

const DEFAULT_IDEMPOTENCY_WINDOWS: Record<OwnerNotificationType, number> = {
  restaurant_live: 30 * 86400,
  restaurant_deletion_scheduled: 7 * 86400,
  restaurant_restored: 7 * 86400,
  payment_failed: 86400,
  payment_recovered: 86400,
  trial_ending_soon: 30 * 86400,
  // 1-day window covers Stripe's webhook retries on the same invoice. The
  // webhook handler also dedupes via the invoice.id pre-check before
  // calling sendOwnerNotification, so this is the second layer of safety.
  payment_received: 86400,
  // 1-day window — covers webhook retries + accidental double-clicks. Owner
  // clicking Cancel/Pause is intentional so we don't want a 30-day mute.
  subscription_cancelled: 86400,
  subscription_paused: 86400,
  // Resume is a positive one-shot event — no dedup needed beyond a short
  // burst window.
  subscription_resumed: 3600,
};

export async function getOwnerContact(
  supabase: SupabaseClient,
  restaurant_id: string,
): Promise<OwnerContact> {
  const { data: restaurant, error: restErr } = await supabase
    .from("restaurants")
    .select("id, name, email, owner_user_id")
    .eq("id", restaurant_id)
    .maybeSingle();
  if (restErr || !restaurant) {
    return { email: null, name: null, restaurantName: null };
  }

  const restaurantName: string | null = (restaurant as any).name ?? null;
  const restaurantEmail: string | null = (restaurant as any).email ?? null;

  // Prefer restaurant.email; fall back to the owner's user_profiles row via
  // user_restaurant_roles (role='owner'). owner_user_id on `restaurants`
  // references user_profiles.id directly in some cases — try both paths.
  if (restaurantEmail) {
    // Try to enrich with the owner's name even when restaurant.email is set.
    let ownerName: string | null = null;
    try {
      const { data: roleRows } = await supabase
        .from("user_restaurant_roles")
        .select("user_id")
        .eq("restaurant_id", restaurant_id)
        .eq("role", "owner")
        .limit(1);
      const userId = roleRows?.[0]?.user_id ?? (restaurant as any).owner_user_id ?? null;
      if (userId) {
        const { data: profile } = await supabase
          .from("user_profiles")
          .select("full_name")
          .eq("id", userId)
          .maybeSingle();
        ownerName = (profile as any)?.full_name ?? null;
      }
    } catch (_) {
      // best-effort; ownerName stays null
    }
    return { email: restaurantEmail, name: ownerName, restaurantName };
  }

  // No email on restaurant — find owner via user_restaurant_roles.
  try {
    const { data: roleRows } = await supabase
      .from("user_restaurant_roles")
      .select("user_id")
      .eq("restaurant_id", restaurant_id)
      .eq("role", "owner")
      .limit(1);
    const userId = roleRows?.[0]?.user_id ?? (restaurant as any).owner_user_id ?? null;
    if (userId) {
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("email, full_name")
        .eq("id", userId)
        .maybeSingle();
      return {
        email: (profile as any)?.email ?? null,
        name: (profile as any)?.full_name ?? null,
        restaurantName,
      };
    }
  } catch (_) {
    // fall through
  }

  return { email: null, name: null, restaurantName };
}

function fmtDate(value: unknown): string {
  if (!value) return "soon";
  try {
    const d = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(d.getTime())) return String(value);
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "full",
      timeZone: "America/Toronto",
    }).format(d);
  } catch (_) {
    return String(value);
  }
}

function buildTemplate(
  type: OwnerNotificationType,
  ownerName: string,
  restaurantName: string,
  context: Record<string, unknown>,
): { subject: string; body: string } {
  const greet = ownerName ? `Hi ${ownerName},` : "Hi,";
  const trialEndDate = fmtDate(context.trialEndDate ?? context.trial_ends_at);
  const scheduledPurgeAt = fmtDate(context.scheduledPurgeAt ?? context.scheduled_purge_at);

  switch (type) {
    case "restaurant_live":
      return {
        subject: "Welcome to Cenaiva — you're live!",
        body:
          `${greet} your restaurant ${restaurantName} is now live on Cenaiva. ` +
          `Your 90-day free trial started today and ends ${trialEndDate}. ` +
          `After that, $199.99 CAD/month, cancel anytime. ` +
          `Manage your subscription anytime at https://cenaiva.com/dashboard/settings.`,
      };
    case "restaurant_deletion_scheduled":
      return {
        subject: `${restaurantName} is scheduled for deletion`,
        body:
          `${greet} you scheduled ${restaurantName} for deletion. ` +
          `Your restaurant has been hidden from diners. ` +
          `Your subscription will end at the close of your current billing period — no further charges after that. ` +
          `You have until ${scheduledPurgeAt} (30 days) to restore. ` +
          `After that, your restaurant data will be anonymized. ` +
          `To restore: visit https://cenaiva.com/dashboard.`,
      };
    case "restaurant_restored":
      return {
        subject: `${restaurantName} restored`,
        body:
          `${greet} ${restaurantName} has been restored. ` +
          `Your subscription is active again. ` +
          `If it's eligible to be published, it's already visible to diners.`,
      };
    case "payment_failed":
      return {
        subject: `Payment failed — ${restaurantName} is paused`,
        body:
          `${greet} your last Cenaiva payment couldn't go through. ` +
          `We've paused ${restaurantName} so it's hidden from diners. ` +
          `To come back online, update your card at https://cenaiva.com/dashboard/settings. ` +
          `Once payment succeeds, your restaurant is automatically republished.`,
      };
    case "payment_recovered":
      return {
        subject: `${restaurantName} is back online`,
        body:
          `${greet} your payment went through. ${restaurantName} is back live for diners. ` +
          `Thanks for sticking with Cenaiva.`,
      };
    case "trial_ending_soon":
      return {
        subject: "Your Cenaiva trial ends in 7 days",
        body:
          `${greet} just a heads up — your 90-day free trial for ${restaurantName} ends on ${trialEndDate}. ` +
          `After that, $199.99 CAD/month will be charged to your card on file. ` +
          `Cancel anytime via https://cenaiva.com/dashboard/settings.`,
      };
    case "subscription_cancelled": {
      const periodEnd = typeof context.periodEndDate === "string"
        ? (context.periodEndDate as string)
        : null;
      const tail = periodEnd
        ? `You'll stay live until ${periodEnd}, then ${restaurantName} will be unpublished. `
        : `Your service continues through the end of your current billing cycle, then ${restaurantName} will be unpublished. `;
      return {
        subject: periodEnd
          ? `Your Cenaiva subscription ends on ${periodEnd}`
          : `Your Cenaiva subscription will end soon`,
        body:
          `${greet} we've scheduled your Cenaiva subscription to end. ` +
          tail +
          `Changed your mind? Resume any time before then from https://cenaiva.com/dashboard/settings — your service continues uninterrupted.`,
      };
    }
    case "subscription_paused":
      return {
        subject: `Cenaiva subscription paused — ${restaurantName} is hidden from diners`,
        body:
          `${greet} we've paused billing for ${restaurantName}. ` +
          `Your existing reservations stay valid (diners still show up), but the restaurant is hidden from Discover and we won't bill you while paused. ` +
          `Resume any time from https://cenaiva.com/dashboard/settings to bring ${restaurantName} back online.`,
      };
    case "subscription_resumed":
      return {
        subject: `Welcome back — ${restaurantName} is active again`,
        body:
          `${greet} your Cenaiva subscription is active again. ` +
          `${restaurantName} is back live for diners and your billing resumed. ` +
          `Manage your plan any time at https://cenaiva.com/dashboard/settings.`,
      };
    case "payment_received": {
      const amount = typeof context.amount === "string"
        ? (context.amount as string)
        : "your monthly invoice";
      const paidOn = typeof context.paidOn === "string"
        ? (context.paidOn as string)
        : "today";
      const hostedInvoiceUrl = typeof context.hostedInvoiceUrl === "string"
        ? (context.hostedInvoiceUrl as string)
        : null;
      const bookingCount = typeof context.bookingCount === "number"
        ? (context.bookingCount as number)
        : 0;
      const lineSummary = bookingCount > 0
        ? `${bookingCount} booking fee${bookingCount === 1 ? "" : "s"} + your $199.99 subscription`
        : `your $199.99 subscription`;
      return {
        subject: `Cenaiva — Payment received: ${amount}`,
        body:
          `${greet} we received ${amount} for ${restaurantName} on ${paidOn} ` +
          `(${lineSummary}). ` +
          (hostedInvoiceUrl
            ? `View your receipt: ${hostedInvoiceUrl}\n\n`
            : "") +
          `Thanks for using Cenaiva.`,
      };
    }
  }
}

export async function sendOwnerNotification(
  opts: SendOwnerNotificationOpts,
): Promise<SendOwnerNotificationResult> {
  const { supabase, restaurant_id, type, context } = opts;
  const idempotencyWindow = opts.idempotent_within_seconds ?? DEFAULT_IDEMPOTENCY_WINDOWS[type];

  // Idempotency check: skip if a 'sent' row of same type exists within window.
  try {
    const cutoff = new Date(Date.now() - idempotencyWindow * 1000).toISOString();
    const { data: existing, error: idemErr } = await supabase
      .from("restaurant_notification_log")
      .select("id")
      .eq("restaurant_id", restaurant_id)
      .eq("notification_type", type)
      .eq("status", "sent")
      .gt("sent_at", cutoff)
      .limit(1);
    if (!idemErr && existing && existing.length > 0) {
      return { status: "skipped", message: "idempotent_window_active" };
    }
  } catch (err) {
    console.error("[owner-notifications] idempotency check error", err);
    // continue — fail-open is safer than missing a critical notification
  }

  const contact = await getOwnerContact(supabase, restaurant_id);
  if (!contact.email) {
    return { status: "failed", message: "no_owner_email" };
  }

  const restaurantName =
    (context.restaurantName as string | undefined) ?? contact.restaurantName ?? "your restaurant";
  const ownerName = contact.name ?? "";
  const { subject, body } = buildTemplate(type, ownerName, restaurantName, context);

  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) {
    // Log the failure attempt so audit shows we tried — and ops can see the
    // missing env var.
    try {
      await supabase.from("restaurant_notification_log").insert({
        restaurant_id,
        notification_type: type,
        sent_to_email: contact.email,
        payload: { context, subject, body },
        status: "failed",
        failure_reason: "resend_api_key_missing",
      });
    } catch (_) {
      // ignore — telemetry only
    }
    return { status: "failed", message: "resend_api_key_missing" };
  }

  const resend = new Resend(resendKey);
  const fromAddr = Deno.env.get("RESEND_FROM_EMAIL") ?? "Cenaiva <hello@cenaiva.com>";

  try {
    await resend.emails.send({
      from: fromAddr,
      to: contact.email,
      subject,
      text: body,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[owner-notifications] ${type} send failed`, msg);
    try {
      await supabase.from("restaurant_notification_log").insert({
        restaurant_id,
        notification_type: type,
        sent_to_email: contact.email,
        payload: { context, subject, body },
        status: "failed",
        failure_reason: msg.slice(0, 500),
      });
    } catch (_) {
      // ignore
    }
    return { status: "failed", message: msg };
  }

  try {
    await supabase.from("restaurant_notification_log").insert({
      restaurant_id,
      notification_type: type,
      sent_to_email: contact.email,
      payload: { context, subject },
      status: "sent",
    });
  } catch (err) {
    // The email already shipped — log but don't downgrade the result.
    console.error("[owner-notifications] log insert failed", err);
  }

  return { status: "sent" };
}
