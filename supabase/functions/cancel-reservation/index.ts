import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  formatReservationDate,
  sendReservationNotification,
} from "../_shared/reservation-notifications.ts";
import { enforceRateLimit, rateLimitIdentifier, RateLimitError } from "../_shared/rate-limit.ts";
import { sendNotifyMeSms, type FulfilledAlertRow } from "../_shared/notify-me-sms.ts";

// Status semantics: this function permits cancelling reservations in any
// status except an already-`cancelled` one (idempotent OK) or a past one
// (rejected). That includes `seated`, `completed`, and `no_show` — diners
// retain the ability to retract a booking even after the meal. The release
// of `reservation_tables` happens via release_reservation_tables RPC, which
// throws on `seated` rows; we fall back to a manual UPDATE in that case so
// the cancel still completes. If business rules later require locking out
// seated/completed cancels, do it here at the top of the handler.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type RequestBody = {
  reservation_id?: unknown;
  reservationId?: unknown;
  confirmation_code?: unknown;
  confirmationCode?: unknown;
};

type ReservationRow = {
  id: string;
  restaurant_id: string;
  guest_id: string;
  user_profile_id: string | null;
  reserved_at: string;
  party_size: number;
  status: string | null;
  table_id: string | null;
  confirmation_code: string | null;
  guest_full_name: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  // Event/promo linkage — needed so the cancellation SMS body can mention
  // the event name / promotion title + code the diner originally booked.
  event_id: string | null;
  promotion_id: string | null;
  applied_promo_code: string | null;
};

type ReservationTableRow = {
  table_id: string;
};

type GuestRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
};

type RestaurantRow = {
  name: string | null;
  timezone: string | null;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const body = (await req.json().catch(() => ({}))) as RequestBody;
    const reservationId = cleanString(body.reservation_id ?? body.reservationId);
    const providedCode = cleanString(body.confirmation_code ?? body.confirmationCode);
    if (!reservationId) return json({ error: "reservation_id is required" }, 400);

    const { data: reservation, error: reservationError } = await adminClient
      .from("reservations")
      .select("id, restaurant_id, guest_id, user_profile_id, reserved_at, party_size, status, table_id, confirmation_code, guest_full_name, guest_email, guest_phone, event_id, promotion_id, applied_promo_code")
      .eq("id", reservationId)
      .maybeSingle<ReservationRow>();
    if (reservationError) return json({ error: reservationError.message }, 400);
    if (!reservation) return json({ error: "Reservation not found" }, 404);

    let guest: GuestRow | null = null;
    const authHeader = req.headers.get("Authorization") ?? "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (bearerToken) {
      const {
        data: { user },
        error: userError,
      } = await adminClient.auth.getUser(bearerToken);
      if (userError || !user) return json({ error: "Invalid or expired session" }, 401);

      const { data: profile, error: profileError } = await adminClient
        .from("user_profiles")
        .select("id")
        .eq("auth_user_id", user.id)
        .maybeSingle();
      if (profileError) return json({ error: profileError.message }, 400);
      if (!profile) return json({ error: "User profile not found" }, 403);

      const { data: ownedGuest, error: guestError } = await adminClient
        .from("guests")
        .select("id, full_name, email, phone")
        .eq("id", reservation.guest_id)
        .eq("user_profile_id", profile.id)
        .maybeSingle<GuestRow>();
      if (guestError) return json({ error: guestError.message }, 400);
      if (!ownedGuest) return json({ error: "You can only cancel your own reservations" }, 403);
      guest = ownedGuest;
    } else if (providedCode) {
      const expectedCode = (reservation.confirmation_code ?? "").trim();
      if (!expectedCode || expectedCode.toLowerCase() !== providedCode.toLowerCase()) {
        return json({ error: "Invalid confirmation code" }, 401);
      }
      const { data: linkedGuest } = await adminClient
        .from("guests")
        .select("id, full_name, email, phone")
        .eq("id", reservation.guest_id)
        .maybeSingle<GuestRow>();
      guest = linkedGuest;
    } else {
      return json({ error: "Authentication required" }, 401);
    }

    // Rate limit. Lower than booking (20/min) and modify (15/min) — cancel
    // shouldn't happen in bursts. Bucket per logged-in diner when present,
    // otherwise per IP (and a confirmation_code path effectively gets per-IP).
    try {
      await enforceRateLimit(
        adminClient,
        "cancel",
        rateLimitIdentifier(req, reservation.user_profile_id ?? null),
        { limit: 10, windowSeconds: 60 },
      );
    } catch (e) {
      if (e instanceof RateLimitError) {
        return json({ error: e.message, unavailable_reason: "rate_limited" }, 429);
      }
      throw e;
    }

    if (reservation.status === "cancelled") {
      return json({ ok: true, reservation_id: reservationId, status: "cancelled" });
    }

    const reservedAt = new Date(reservation.reserved_at);
    if (Number.isNaN(reservedAt.getTime())) {
      return json({ error: "Reservation date is invalid" }, 400);
    }
    if (reservedAt.getTime() < Date.now()) {
      return json({ error: "Past reservations cannot be cancelled" }, 400);
    }

    const { data: restaurant } = await adminClient
      .from("restaurants")
      .select("name, timezone")
      .eq("id", reservation.restaurant_id)
      .maybeSingle<RestaurantRow>();
    const restaurantName =
      typeof restaurant?.name === "string" && restaurant.name.trim()
        ? restaurant.name.trim()
        : "the restaurant";
    const guestName =
      reservation.guest_full_name?.trim() ||
      guest?.full_name?.trim() ||
      "there";
    const guestEmail = reservation.guest_email?.trim() || guest?.email?.trim() || null;
    const guestPhone = reservation.guest_phone?.trim() || guest?.phone?.trim() || null;
    const dateLabel = formatReservationDate(
      reservedAt,
      restaurant?.timezone?.trim() || "America/Toronto",
    );
    const codeLine = reservation.confirmation_code?.trim()
      ? ` Confirmation code: ${reservation.confirmation_code.trim()}.`
      : "";

    // Surface the event / promotion the reservation is linked to in the SMS
    // body so the diner immediately recognises which booking was cancelled.
    let eventLine = "";
    let promoLine = "";
    if (reservation.event_id) {
      const { data: ev } = await adminClient
        .from("events")
        .select("name")
        .eq("id", reservation.event_id)
        .maybeSingle<{ name: string | null }>();
      if (ev?.name) eventLine = ` Event: ${ev.name}.`;
    }
    if (reservation.promotion_id) {
      const { data: pr } = await adminClient
        .from("promotions")
        .select("title, promo_code")
        .eq("id", reservation.promotion_id)
        .maybeSingle<{ title: string | null; promo_code: string | null }>();
      if (pr?.title) {
        const codePart = pr.promo_code ? ` (code ${pr.promo_code})` : "";
        promoLine = ` Promo: ${pr.title}${codePart}.`;
      }
    } else if (reservation.applied_promo_code) {
      promoLine = ` Promo code: ${reservation.applied_promo_code}.`;
    }

    const sendCancellationNotice = async () => {
      if (!guest) {
        // No linked guest record — skip notification but report skipped status.
        return { status: "skipped" as const, channel: null };
      }
      return await sendReservationNotification({
        supabase: adminClient,
        guestId: guest.id,
        restaurantId: reservation.restaurant_id,
        reservationId,
        type: "reservation_cancellation",
        email: guestEmail,
        phone: guestPhone,
        subject: `Your reservation at ${restaurantName} was cancelled`,
        body:
          `Hi ${guestName}, your reservation at ${restaurantName} for ${reservation.party_size} ` +
          `${reservation.party_size === 1 ? "guest" : "guests"} on ${dateLabel} has been cancelled.` +
          codeLine +
          eventLine +
          promoLine,
      });
    };

    const { error: updateError } = await adminClient
      .from("reservations")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancellation_reason: "Cancelled by diner",
      })
      .eq("id", reservationId);
    if (updateError) return json({ error: updateError.message }, 400);

    // Notify Me fan-out: when a slot frees up we ping any active
    // `availability_alerts` rows that match this restaurant + date + party.
    // Both the in-app notification (created inside the match RPC) AND a
    // best-effort SMS (via sendNotifyMeSms) get dispatched. Wrapped in
    // try/catch so any fan-out failure can NEVER block the cancel
    // response. RPC is a no-op when zero alerts match.
    const fanOutSlotOpened = async () => {
      try {
        const rows: FulfilledAlertRow[] = [];
        const { data: restRows, error: restErr } = await adminClient.rpc(
          "match_availability_alerts_for_restaurant",
          {
            p_restaurant_id: reservation.restaurant_id,
            p_freed_at: reservation.reserved_at,
            p_freed_party_size: reservation.party_size,
          },
        );
        if (!restErr && restRows) rows.push(...(restRows as FulfilledAlertRow[]));
        if (reservation.event_id) {
          const { data: evtRows, error: evtErr } = await adminClient.rpc(
            "match_availability_alerts_for_event",
            { p_event_id: reservation.event_id },
          );
          if (!evtErr && evtRows) rows.push(...(evtRows as FulfilledAlertRow[]));
        }
        if (rows.length > 0) {
          // Fire-and-forget the SMS dispatch so Twilio latency never blocks
          // the cancel response. waitUntil keeps the promise alive after
          // the function returns. Falls back to a plain promise if the
          // runtime doesn't expose waitUntil (local Deno).
          const dispatch = sendNotifyMeSms(adminClient, rows).catch((e) =>
            console.warn("[cancel-reservation] notify-me SMS dispatch failed:", e),
          );
          const edge = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
            .EdgeRuntime;
          if (edge?.waitUntil) edge.waitUntil(dispatch);
        }
      } catch (e) {
        // Swallow — alert fan-out must never block cancel.
        console.warn("[cancel-reservation] notify-me fan-out failed:", e);
      }
    };

    const { error: rpcReleaseError } = await adminClient.rpc("release_reservation_tables", {
      p_reservation_id: reservationId,
    });
    if (!rpcReleaseError) {
      await fanOutSlotOpened();
      const notification = await sendCancellationNotice();
      return json({
        ok: true,
        reservation_id: reservationId,
        status: "cancelled",
        notification_delivery: notification.status,
        notification_delivery_channel: notification.channel,
      });
    }

    const { data: assignedTables, error: assignedTablesError } = await adminClient
      .from("reservation_tables")
      .select("table_id")
      .eq("reservation_id", reservationId)
      .is("released_at", null)
      .returns<ReservationTableRow[]>();
    if (assignedTablesError && assignedTablesError.code !== "42P01") {
      return json({ error: assignedTablesError.message }, 400);
    }

    const tableIds = Array.from(
      new Set([
        ...((assignedTables ?? []).map((row) => row.table_id)),
        ...(reservation.table_id ? [reservation.table_id] : []),
      ]),
    );

    const { error: linkReleaseError } = await adminClient
      .from("reservation_tables")
      .update({ released_at: new Date().toISOString() })
      .eq("reservation_id", reservationId)
      .is("released_at", null);
    if (linkReleaseError && linkReleaseError.code !== "42P01") {
      return json({ error: linkReleaseError.message }, 400);
    }

    if (tableIds.length > 0) {
      const { error: tableUpdateError } = await adminClient
        .from("tables")
        .update({
          status: "empty",
          seated_count: 0,
          combined_with: null,
          updated_at: new Date().toISOString(),
        })
        .in("id", tableIds)
        .neq("status", "blocked");
      if (tableUpdateError) return json({ error: tableUpdateError.message }, 400);
    }

    await fanOutSlotOpened();
    const notification = await sendCancellationNotice();
    return json({
      ok: true,
      reservation_id: reservationId,
      status: "cancelled",
      notification_delivery: notification.status,
      notification_delivery_channel: notification.channel,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
