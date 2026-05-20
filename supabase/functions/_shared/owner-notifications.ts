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
  | "subscription_resumed"
  | "new_reservation_owner"
  | "cancellation_owner";

export interface SendOwnerNotificationOpts {
  supabase: SupabaseClient;
  restaurant_id: string;
  type: OwnerNotificationType;
  context: Record<string, unknown>;
  idempotent_within_seconds?: number;
  /** When provided, skip `getOwnerContact()` and use this contact instead.
   *  Used by reservation-event notifications which intentionally bypass
   *  `restaurants.email` (the shared inbox) and always email the human
   *  owner directly. */
  contactOverride?: OwnerContact;
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
  // Reservation events fire per-reservation and the upstream `book_reservation`
  // RPC already enforces uniqueness via advisory locks + the diner-double-
  // book exclusion. We only need to swat retry storms from the same insert
  // burst, so the window is tight.
  new_reservation_owner: 5,
  cancellation_owner: 5,
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
    case "new_reservation_owner": {
      const guestName = typeof context.guestName === "string" && context.guestName.trim()
        ? (context.guestName as string).trim()
        : "A guest";
      const partySize = typeof context.partySize === "number"
        ? (context.partySize as number)
        : Number(context.partySize ?? 0);
      const reservedAtLabel = typeof context.reservedAtLabel === "string"
        ? (context.reservedAtLabel as string)
        : fmtDate(context.reservedAt);
      const partyLabel = partySize > 0
        ? `, party of ${partySize}`
        : "";
      const confirmation = typeof context.confirmationCode === "string" && context.confirmationCode
        ? ` Confirmation code: ${context.confirmationCode}.`
        : "";
      return {
        subject: `New booking at ${restaurantName} — ${guestName}`,
        body:
          `${greet} ${guestName}${partyLabel} is booked at ${restaurantName} for ${reservedAtLabel}.` +
          confirmation +
          ` See it in your dashboard: https://cenaiva.com/dashboard/reservations.`,
      };
    }
    case "cancellation_owner": {
      const guestName = typeof context.guestName === "string" && context.guestName.trim()
        ? (context.guestName as string).trim()
        : "A guest";
      const reservedAtLabel = typeof context.reservedAtLabel === "string"
        ? (context.reservedAtLabel as string)
        : fmtDate(context.reservedAt);
      const actor = context.actor === "owner"
        ? "You cancelled "
        : `${guestName} cancelled `;
      return {
        subject: `Booking cancelled at ${restaurantName} — ${guestName}`,
        body:
          `${greet} ${actor}the reservation at ${restaurantName} for ${reservedAtLabel}. ` +
          `Any deposit or pre-order paid will be refunded to the diner's card. ` +
          `Manage your bookings: https://cenaiva.com/dashboard/reservations.`,
      };
    }
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

  const contact = opts.contactOverride ?? (await getOwnerContact(supabase, restaurant_id));
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

// ─────────────────────────────────────────────────────────────────────────────
// Reservation-event notifications (per-owner toggle, bypasses restaurants.email)
//
// Lifecycle emails above prefer the restaurant's shared inbox if set.
// Reservation-event emails are different: they're about a specific booking
// the human owner wants (or doesn't want) to know about, and the toggle that
// gates them lives on the *owner's* user_profiles row. Sending those to a
// generic mailbox would defeat the toggle. So these helpers always resolve
// the human owner via user_restaurant_roles → user_profiles directly.
// ─────────────────────────────────────────────────────────────────────────────

interface OwnerProfileContact extends OwnerContact {
  /** user_profiles.id of the owner. Null when no owner record could be
   *  located — caller should treat that as "skip the send". */
  profileId: string | null;
}

export async function getRestaurantOwnerProfile(
  supabase: SupabaseClient,
  restaurant_id: string,
): Promise<OwnerProfileContact> {
  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("id, name, owner_user_id")
    .eq("id", restaurant_id)
    .maybeSingle();
  const restaurantName: string | null = (restaurant as any)?.name ?? null;

  // Primary path: user_restaurant_roles. is_primary=true wins; otherwise
  // the oldest owner row (whoever was added first) — matches the existing
  // single-owner-pick convention used elsewhere.
  let userId: string | null = null;
  try {
    const { data: roleRows } = await supabase
      .from("user_restaurant_roles")
      .select("user_id, is_primary, created_at")
      .eq("restaurant_id", restaurant_id)
      .eq("role", "owner")
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(1);
    userId = roleRows?.[0]?.user_id ?? null;
  } catch (_) {
    // fall through
  }
  if (!userId) {
    userId = (restaurant as any)?.owner_user_id ?? null;
  }
  if (!userId) {
    return { email: null, name: null, restaurantName, profileId: null };
  }

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("id, email, full_name")
    .eq("id", userId)
    .maybeSingle();
  return {
    email: (profile as any)?.email ?? null,
    name: (profile as any)?.full_name ?? null,
    restaurantName,
    profileId: (profile as any)?.id ?? null,
  };
}

type NotificationPreferenceKey = "new_reservation_email" | "cancellation_email";

async function readOwnerPreference(
  supabase: SupabaseClient,
  profileId: string,
  key: NotificationPreferenceKey,
): Promise<boolean> {
  try {
    const { data } = await supabase
      .from("user_profiles")
      .select("notification_preferences_json")
      .eq("id", profileId)
      .maybeSingle();
    const prefs = (data as any)?.notification_preferences_json ?? null;
    if (prefs && typeof prefs === "object" && key in prefs) {
      return prefs[key] !== false; // explicit false disables; otherwise default-on
    }
  } catch (err) {
    console.error("[owner-notifications] preference read failed", err);
    // Fail-open: prefer over-notifying to silently dropping.
  }
  return true;
}

export interface NotifyOwnerReservationOpts {
  supabase: SupabaseClient;
  restaurant_id: string;
  reservation_id: string;
  reserved_at: string | Date;
  party_size: number;
  guest_full_name: string | null;
  confirmation_code?: string | null;
  /** Cancellation only: which side initiated the cancel. */
  actor?: "diner" | "owner";
}

async function buildReservationContext(
  supabase: SupabaseClient,
  opts: NotifyOwnerReservationOpts,
  contact: OwnerProfileContact,
): Promise<Record<string, unknown>> {
  // Pull the restaurant's timezone so the date label matches what the
  // owner reads on the dashboard. Falls back to America/Toronto (Cenaiva
  // default) when missing.
  let timezone = "America/Toronto";
  try {
    const { data } = await supabase
      .from("restaurants")
      .select("timezone")
      .eq("id", opts.restaurant_id)
      .maybeSingle();
    const tz = (data as any)?.timezone;
    if (typeof tz === "string" && tz.trim()) timezone = tz;
  } catch (_) {
    // ignore
  }
  let reservedAtLabel = "soon";
  try {
    const d = opts.reserved_at instanceof Date ? opts.reserved_at : new Date(opts.reserved_at);
    if (!Number.isNaN(d.getTime())) {
      reservedAtLabel = new Intl.DateTimeFormat("en-US", {
        dateStyle: "full",
        timeStyle: "short",
        timeZone: timezone,
      }).format(d);
    }
  } catch (_) {
    // ignore
  }
  return {
    restaurantName: contact.restaurantName,
    guestName: opts.guest_full_name,
    partySize: opts.party_size,
    reservedAt: opts.reserved_at,
    reservedAtLabel,
    confirmationCode: opts.confirmation_code ?? null,
    reservationId: opts.reservation_id,
  };
}

export async function notifyOwnerNewReservation(
  opts: NotifyOwnerReservationOpts,
): Promise<SendOwnerNotificationResult> {
  const contact = await getRestaurantOwnerProfile(opts.supabase, opts.restaurant_id);
  if (!contact.email || !contact.profileId) {
    return { status: "failed", message: "no_owner_profile" };
  }
  const enabled = await readOwnerPreference(opts.supabase, contact.profileId, "new_reservation_email");
  if (!enabled) {
    return { status: "skipped", message: "owner_preference_off" };
  }
  const context = await buildReservationContext(opts.supabase, opts, contact);
  return sendOwnerNotification({
    supabase: opts.supabase,
    restaurant_id: opts.restaurant_id,
    type: "new_reservation_owner",
    context,
    contactOverride: contact,
  });
}

export async function notifyOwnerCancellation(
  opts: NotifyOwnerReservationOpts,
): Promise<SendOwnerNotificationResult> {
  const contact = await getRestaurantOwnerProfile(opts.supabase, opts.restaurant_id);
  if (!contact.email || !contact.profileId) {
    return { status: "failed", message: "no_owner_profile" };
  }
  const enabled = await readOwnerPreference(opts.supabase, contact.profileId, "cancellation_email");
  if (!enabled) {
    return { status: "skipped", message: "owner_preference_off" };
  }
  const baseContext = await buildReservationContext(opts.supabase, opts, contact);
  const context = { ...baseContext, actor: opts.actor ?? "diner" };
  return sendOwnerNotification({
    supabase: opts.supabase,
    restaurant_id: opts.restaurant_id,
    type: "cancellation_owner",
    context,
    contactOverride: contact,
  });
}
