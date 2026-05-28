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
  | "cancellation_owner"
  | "payment_failed_diner"
  | "charge_dispute_created"
  | "charge_dispute_closed"
  | "booking_cart_modified";

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
  /** 2026-05-28: when set, dedup is atomic per-reservation via the
   *  restaurant_notification_log unique index
   *  (restaurant_id, notification_type, reservation_id) WHERE status='sent'.
   *  Defeats the TOCTOU race in the time-window-only dedup that allowed two
   *  near-simultaneous calls (e.g. confirm-deposit-paid + stripe-webhook
   *  for the same booking) to both pass the SELECT and both INSERT. */
  reservation_id?: string;
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
  // Diner payment failure: tight idempotency keyed on reservation_id
  // happens at the call site (template body includes the confirmation
  // code). A short burst window swats Stripe webhook retries for the
  // same PI.
  payment_failed_diner: 60,
  // Disputes: created window matches Stripe's standard evidence window
  // (~7 days) so duplicate-create events from Stripe retries don't double-
  // email. Closed disputes get a 30-day window — won/lost/warning_closed
  // is a terminal state per dispute and we never want to re-notify.
  charge_dispute_created: 7 * 86400,
  charge_dispute_closed: 30 * 86400,
  // Cart modifications: tight burst window so a flurry of edits within
  // a few seconds collapses to one email, but legitimate sequential
  // updates each surface to the owner.
  booking_cart_modified: 30,
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
    case "payment_failed_diner": {
      const confirmationCode = typeof context.confirmationCode === "string"
        ? (context.confirmationCode as string)
        : "(no code)";
      const amount = typeof context.amount === "string"
        ? (context.amount as string)
        : "$—";
      const reason = typeof context.failureReason === "string" && context.failureReason
        ? (context.failureReason as string)
        : "Card declined";
      const guestName = typeof context.guestName === "string" && context.guestName.trim()
        ? (context.guestName as string).trim()
        : "A diner";
      return {
        subject: `Heads up — a diner's payment failed at ${restaurantName}`,
        body:
          `${greet} ${guestName}'s payment for ${restaurantName} just failed. ` +
          `Reservation: ${confirmationCode}, Amount: ${amount}, Reason: ${reason}. ` +
          `The booking has been auto-cancelled. No action needed; just a heads-up so you can plan.`,
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
    case "charge_dispute_created": {
      const amount = typeof context.amount === "string"
        ? (context.amount as string)
        : "—";
      const reservationCode = typeof context.reservation_code === "string"
        ? (context.reservation_code as string)
        : null;
      const reason = typeof context.reason === "string"
        ? (context.reason as string)
        : null;
      const evidenceDueBy = typeof context.evidence_due_by === "string"
        ? (context.evidence_due_by as string)
        : null;
      const paymentIntentId = typeof context.payment_intent_id === "string"
        ? (context.payment_intent_id as string)
        : null;
      const lines: string[] = [
        greet,
        ``,
        `A diner just disputed a $${amount} charge at ${restaurantName}.`,
        `Stripe has temporarily withheld $${amount} plus a $15 dispute fee.`,
      ];
      if (reason) lines.push(`Reason given: ${reason}.`);
      if (reservationCode) lines.push(`Reservation: ${reservationCode}.`);
      lines.push(
        evidenceDueBy
          ? `You have until ${evidenceDueBy} to submit evidence. Without a response, the dispute is automatically lost.`
          : `Stripe will contact you with an evidence deadline. Submit within the window or the dispute is automatically lost.`,
      );
      lines.push(``);
      lines.push(`Submit evidence (receipts, communication, no-show records) from your Stripe dashboard:`);
      lines.push(
        paymentIntentId
          ? `https://dashboard.stripe.com/payments/${paymentIntentId}`
          : `https://dashboard.stripe.com/disputes`,
      );
      lines.push(``);
      lines.push(`Need help? Reply to this email and we'll walk you through it.`);
      lines.push(``);
      lines.push(`— Cenaiva`);
      return {
        subject: `Action required — payment dispute at ${restaurantName}`,
        body: lines.join("\n"),
      };
    }
    case "charge_dispute_closed": {
      const amount = typeof context.amount === "string"
        ? (context.amount as string)
        : "—";
      const reservationCode = typeof context.reservation_code === "string"
        ? (context.reservation_code as string)
        : null;
      const outcomeRaw = typeof context.outcome === "string" ? context.outcome : "warning_closed";
      const outcome: "won" | "lost" | "warning_closed" =
        outcomeRaw === "won" || outcomeRaw === "lost" ? outcomeRaw : "warning_closed";
      const paymentIntentId = typeof context.payment_intent_id === "string"
        ? (context.payment_intent_id as string)
        : null;
      const resTail = reservationCode ? ` (reservation ${reservationCode})` : "";
      if (outcome === "won") {
        return {
          subject: `Dispute resolved in your favour — ${restaurantName}`,
          body: [
            greet,
            ``,
            `Good news — Stripe resolved the dispute in your favour for the $${amount} charge at ${restaurantName}${resTail}.`,
            `The funds and the $15 dispute fee have been returned to your balance. No further action needed.`,
            ``,
            `— Cenaiva`,
          ].join("\n"),
        };
      }
      if (outcome === "lost") {
        const lines: string[] = [
          greet,
          ``,
          `The dispute on the $${amount} charge at ${restaurantName}${resTail} was resolved against you. Stripe has kept the disputed amount and the $15 dispute fee.`,
          ``,
          `To reduce future disputes, consider tightening your cancellation/no-show policy and keeping reservation communications in writing.`,
        ];
        if (paymentIntentId) {
          lines.push(`Full breakdown: https://dashboard.stripe.com/payments/${paymentIntentId}`);
        }
        lines.push(``);
        lines.push(`— Cenaiva`);
        return {
          subject: `Dispute lost — ${restaurantName}`,
          body: lines.join("\n"),
        };
      }
      // warning_closed
      return {
        subject: `Dispute warning closed — ${restaurantName}`,
        body: [
          greet,
          ``,
          `An inquiry/warning on the $${amount} charge at ${restaurantName}${resTail} was closed by the cardholder's bank with no chargeback. No funds were withheld. No action needed.`,
          ``,
          `— Cenaiva`,
        ].join("\n"),
      };
    }
    case "booking_cart_modified": {
      const dinerName = typeof context.dinerName === "string" && context.dinerName.trim()
        ? (context.dinerName as string).trim()
        : "A diner";
      const reservedAtLabel = typeof context.reservedAtLabel === "string"
        ? (context.reservedAtLabel as string)
        : fmtDate(context.reservedAt);
      const summary = typeof context.summary === "string"
        ? (context.summary as string)
        : "Cart updated";
      const confirmationCode = typeof context.confirmationCode === "string"
        ? (context.confirmationCode as string)
        : null;
      const addedItems = Array.isArray(context.addedItems)
        ? (context.addedItems as Array<{ name?: string; quantity?: number }>)
        : [];
      const removedItems = Array.isArray(context.removedItems)
        ? (context.removedItems as Array<{ name?: string; quantity?: number }>)
        : [];
      const newTotal = typeof context.newTotalLabel === "string"
        ? (context.newTotalLabel as string)
        : null;

      const addedBlock = addedItems.length > 0
        ? `Added:\n${addedItems
          .map((i) => `  + ${i.quantity ?? 1}× ${i.name ?? "(item)"}`)
          .join("\n")}\n\n`
        : "";
      const removedBlock = removedItems.length > 0
        ? `Removed:\n${removedItems
          .map((i) => `  − ${i.quantity ?? 1}× ${i.name ?? "(item)"}`)
          .join("\n")}\n\n`
        : "";
      const totalLine = newTotal ? `New pre-order total: ${newTotal}\n` : "";
      const confLine = confirmationCode ? `Confirmation: ${confirmationCode}\n` : "";

      return {
        subject: `Pre-order updated at ${restaurantName} — ${dinerName}`,
        body:
          `${greet}\n\n` +
          `${dinerName} updated their pre-order at ${restaurantName} for ${reservedAtLabel}.\n` +
          `${summary}.\n\n` +
          addedBlock +
          removedBlock +
          totalLine +
          confLine +
          `\nView the booking: https://cenaiva.com/dashboard/reservations\n\n` +
          `— Cenaiva`,
      };
    }
  }
}

export async function sendOwnerNotification(
  opts: SendOwnerNotificationOpts,
): Promise<SendOwnerNotificationResult> {
  const { supabase, restaurant_id, type, context, reservation_id } = opts;
  const idempotencyWindow = opts.idempotent_within_seconds ?? DEFAULT_IDEMPOTENCY_WINDOWS[type];

  // Idempotency check. When reservation_id is set, the partial unique
  // index on (restaurant_id, notification_type, reservation_id) WHERE
  // status='sent' is the authoritative atomic guard — we still do this
  // SELECT as a fast-path skip (avoids burning a Resend API call when
  // we already know it's a dup), but the real safety net is the
  // INSERT-with-unique-constraint at the end of the function. When no
  // reservation_id, fall back to the legacy time-window dedup.
  try {
    let query = supabase
      .from("restaurant_notification_log")
      .select("id")
      .eq("restaurant_id", restaurant_id)
      .eq("notification_type", type)
      .eq("status", "sent");
    if (reservation_id) {
      query = query.eq("reservation_id", reservation_id);
    } else {
      const cutoff = new Date(Date.now() - idempotencyWindow * 1000).toISOString();
      query = query.gt("sent_at", cutoff);
    }
    const { data: existing, error: idemErr } = await query.limit(1);
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

  // 2026-05-28 INSERT-first atomic claim. Previously the order was
  // SELECT (dedup check) → Resend send → INSERT (log). That left a race
  // window between SELECT and INSERT where a concurrent call could pass
  // its own SELECT-check before this call's INSERT was committed, then
  // ALSO call Resend → 2 emails to the owner for 1 reservation.
  //
  // New order: INSERT (claim the dedup slot with status='sent' optimistically)
  // → Resend send → if send fails, UPDATE row to status='failed'
  // (frees the unique-index slot for retry, since the partial index is
  // WHERE status='sent'). The 23505 unique_violation guard catches the
  // race winner deterministically — only one call can hold the 'sent'
  // claim at any time.
  let claimedLogId: string | null = null;
  try {
    const insertPayload: Record<string, unknown> = {
      restaurant_id,
      notification_type: type,
      sent_to_email: contact.email,
      payload: { context, subject },
      status: "sent",
    };
    if (reservation_id) {
      insertPayload.reservation_id = reservation_id;
    }
    const { data: inserted, error: insertErr } = await supabase
      .from("restaurant_notification_log")
      .insert(insertPayload)
      .select("id")
      .single();
    if (insertErr) {
      const code = (insertErr as { code?: string }).code;
      if (code === "23505") {
        console.log(
          "[owner-notifications] dedup raced — another call won the INSERT, skipping send",
          { type, restaurant_id, reservation_id },
        );
        return { status: "skipped", message: "dedup_race_lost" };
      }
      // Other insert error — log but fall through and attempt the send
      // (better to dup-email than miss a critical notification).
      console.error("[owner-notifications] log insert pre-send failed", insertErr);
    } else if (inserted) {
      claimedLogId = (inserted as { id?: string }).id ?? null;
    }
  } catch (err) {
    console.error("[owner-notifications] log insert pre-send threw", err);
  }

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
    // Roll the claimed slot back to 'failed' so retries can re-claim.
    // The partial unique index is WHERE status='sent', so flipping to
    // 'failed' frees the slot atomically.
    if (claimedLogId) {
      try {
        await supabase
          .from("restaurant_notification_log")
          .update({ status: "failed", failure_reason: msg.slice(0, 500) })
          .eq("id", claimedLogId);
      } catch (_) {
        // ignore — telemetry only
      }
    } else {
      // No claim was made (insert errored non-23505); log a failed row.
      try {
        const failedPayload: Record<string, unknown> = {
          restaurant_id,
          notification_type: type,
          sent_to_email: contact.email,
          payload: { context, subject, body },
          status: "failed",
          failure_reason: msg.slice(0, 500),
        };
        if (reservation_id) {
          failedPayload.reservation_id = reservation_id;
        }
        await supabase.from("restaurant_notification_log").insert(failedPayload);
      } catch (_) {
        // ignore
      }
    }
    return { status: "failed", message: msg };
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
    // 2026-05-28: thread reservation_id through so the per-reservation
    // unique index can enforce atomic dedup across the confirm-deposit-paid
    // and stripe-webhook racing call sites.
    reservation_id: opts.reservation_id,
  });
}

export interface NotifyOwnerDinerPaymentFailedOpts {
  supabase: SupabaseClient;
  restaurant_id: string;
  reservation_id: string;
  amount_cents: number;
  failure_reason: string;
  guest_name?: string;
  guest_email?: string;
}

/**
 * Notifies the restaurant owner that a diner's payment attempt failed
 * (and the booking has been auto-cancelled). Fire-and-forget — callers
 * should not await this when responding to a Stripe webhook.
 *
 * Mirrors the `notifyOwnerCancellation` shape but routes through the
 * lifecycle-style template path rather than the per-owner preference
 * toggle — payment failures are always worth surfacing to the owner.
 */
export async function notifyOwnerDinerPaymentFailed(
  opts: NotifyOwnerDinerPaymentFailedOpts,
): Promise<SendOwnerNotificationResult> {
  let confirmationCode: string | null = null;
  let guestName: string | null = opts.guest_name ?? null;
  try {
    const { data } = await opts.supabase
      .from("reservations")
      .select("confirmation_code, guest_full_name")
      .eq("id", opts.reservation_id)
      .maybeSingle();
    confirmationCode = (data as any)?.confirmation_code ?? null;
    if (!guestName) guestName = (data as any)?.guest_full_name ?? null;
  } catch (_) {
    // Best-effort enrichment; template falls back to placeholders.
  }
  const amount = `$${(opts.amount_cents / 100).toFixed(2)}`;
  return sendOwnerNotification({
    supabase: opts.supabase,
    restaurant_id: opts.restaurant_id,
    type: "payment_failed_diner",
    context: {
      reservationId: opts.reservation_id,
      confirmationCode,
      amount,
      failureReason: opts.failure_reason,
      guestName,
      guestEmail: opts.guest_email ?? null,
    },
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

// ─────────────────────────────────────────────────────────────────────────────
// Cart modified — pre-order updated by diner mid-flow
//
// Mirrors the new_booking / cancellation pattern: looks up the owner profile,
// builds an itemized summary, fires email via `sendOwnerNotification` (which
// owns the restaurant_notification_log idempotency check). Fire-and-forget
// from the caller — never await blocking.
// ─────────────────────────────────────────────────────────────────────────────

export interface NotifyOwnerCartModifiedOpts {
  supabase: SupabaseClient;
  restaurant_id: string;
  reservation_id: string;
  /** Diner name as captured at booking time. */
  diner_name: string | null;
  reserved_at: string | Date;
  added_items: Array<{ name: string; quantity: number }>;
  removed_items: Array<{ name: string; quantity: number }>;
  /** Net price delta in cents. Positive = additional charge. */
  delta_cents: number;
  /** Refund amount in cents (caller may set this when delta is negative-style). */
  refund_cents: number;
  /** New pre-order total in cents (post-modification). */
  new_total_cents: number;
  confirmation_code?: string | null;
}

export async function notifyOwnerCartModified(
  restaurantId: string,
  reservationId: string,
  opts: Omit<NotifyOwnerCartModifiedOpts, "restaurant_id" | "reservation_id">,
): Promise<SendOwnerNotificationResult> {
  const supabase = opts.supabase;

  // Look up the owner profile (email + name) the same way other
  // reservation-event notifications do. No per-owner toggle here — cart
  // modifications mid-flow are always operationally relevant.
  const contact = await getRestaurantOwnerProfile(supabase, restaurantId);
  if (!contact.email || !contact.profileId) {
    return { status: "failed", message: "no_owner_profile" };
  }

  // Resolve timezone for date label (matches buildReservationContext).
  let timezone = "America/Toronto";
  try {
    const { data } = await supabase
      .from("restaurants")
      .select("timezone")
      .eq("id", restaurantId)
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

  const fmt = (cents: number): string => `$${(Math.abs(cents) / 100).toFixed(2)}`;
  let summary: string;
  if (opts.delta_cents > 0) {
    summary = `+${fmt(opts.delta_cents)} charged`;
  } else if (opts.refund_cents > 0) {
    summary = `${fmt(opts.refund_cents)} refunded`;
  } else {
    summary = `No price change`;
  }

  // SMS goes to the OWNER'S user_profiles.phone (not restaurants.phone,
  // which is public-facing). Best-effort: pulled inline so we don't widen
  // the OwnerContact contract just for one channel. Fire-and-forget via
  // .catch so a Twilio failure can't surface to the caller.
  void (async () => {
    try {
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("phone")
        .eq("id", contact.profileId!)
        .maybeSingle();
      const phone = (profile as any)?.phone ?? null;
      if (!phone) return;

      const smsDisabled = Deno.env.get("CENAIVA_SMS_DISABLED") === "true";
      if (smsDisabled) return;
      const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID");
      const twilioToken = Deno.env.get("TWILIO_AUTH_TOKEN");
      const twilioFromPhone = Deno.env.get("TWILIO_PHONE_NUMBER");
      if (!twilioSid || !twilioToken || !twilioFromPhone) return;

      // Honor owner opt-out the same way diner SMS does.
      const { isPhoneOptedOut } = await import("./sms.ts");
      if (await isPhoneOptedOut(supabase, phone)) return;

      const normalized = (() => {
        const trimmed = phone.trim();
        if (trimmed.startsWith("+")) return trimmed;
        const digits = trimmed.replace(/\D/g, "");
        if (digits.length === 10) return `+1${digits}`;
        if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
        return trimmed;
      })();

      const twilioMod = await import("npm:twilio@5.0.0");
      const twilioFactory = (twilioMod as any).default ?? twilioMod;
      const twilioClient = twilioFactory(twilioSid, twilioToken);
      const dinerLabel = opts.diner_name?.trim() || "A diner";
      const smsBody =
        `Pre-order updated by ${dinerLabel} for ${reservedAtLabel}. ${summary}.`;
      await twilioClient.messages.create({
        body: smsBody,
        from: twilioFromPhone,
        to: normalized,
      });
    } catch (err) {
      console.warn(
        "[owner-notifications] cart_modified SMS failed",
        err instanceof Error ? err.message : String(err),
      );
    }
  })();

  // Email + log-row are owned by sendOwnerNotification, which also enforces
  // the idempotency window on restaurant_notification_log.
  return sendOwnerNotification({
    supabase,
    restaurant_id: restaurantId,
    type: "booking_cart_modified",
    context: {
      restaurantName: contact.restaurantName,
      dinerName: opts.diner_name,
      reservedAt: opts.reserved_at,
      reservedAtLabel,
      addedItems: opts.added_items,
      removedItems: opts.removed_items,
      deltaCents: opts.delta_cents,
      refundCents: opts.refund_cents,
      newTotalCents: opts.new_total_cents,
      newTotalLabel: fmt(opts.new_total_cents),
      summary,
      confirmationCode: opts.confirmation_code ?? null,
      reservationId,
    },
    contactOverride: contact,
  });
}
