import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { enforceRateLimit, rateLimitIdentifier, RateLimitError } from "../_shared/rate-limit.ts";
import { Resend } from "npm:resend@4.0.0";
import twilio from "npm:twilio@5.0.0";
import { isPhoneOptedOut } from "../_shared/sms.ts";
import {
  closureUnavailableMessage,
  findClosedSpecialDayForDate,
  localDateForDateTime,
} from "../_shared/closures.ts";
import { parseJsonBody } from "../_shared/validation/parse.ts";
import { BookingInputSchema } from "../_shared/validation/booking.ts";
import { notifyOwnerNewReservation } from "../_shared/owner-notifications.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type CartItemInput = {
  menu_item_id?: unknown;
  name?: unknown;
  quantity?: unknown;
  unit_price?: unknown;
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asUuid(value: unknown): string | null {
  const text = asText(value);
  return text && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)
    ? text
    : null;
}

function asNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function roundMoney(value: unknown): number {
  return Math.round(asNumber(value) * 100) / 100;
}

function normalizeCartItems(value: unknown): Array<{
  menu_item_id: string | null;
  name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
}> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as CartItemInput;
    const name = asText(row.name);
    const quantity = Math.max(1, Math.floor(asNumber(row.quantity, 1)));
    const unitPrice = roundMoney(row.unit_price);
    if (!name || unitPrice < 0) return [];
    return [{
      menu_item_id: asUuid(row.menu_item_id),
      name,
      quantity,
      unit_price: unitPrice,
      line_total: roundMoney(unitPrice * quantity),
    }];
  });
}

function formatReservationDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "America/Toronto",
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "POST required" }, 405);

  try {
    const parsed = await parseJsonBody(req, BookingInputSchema, {
      jsonRes: (b, s) => jsonResponse(b as Record<string, unknown>, s),
    });
    if ("response" in parsed) return parsed.response;
    const payload = parsed.data;

    const restaurantId = payload.restaurant_id;
    const shiftId = payload.shift_id;
    const dateTime = payload.date_time;
    const guestName = payload.guest_name;
    const guestEmail = payload.guest_email;
    const guestPhone = payload.guest_phone;
    const allergies = payload.allergies ?? null;
    const seatingPreference = payload.seating_preference ?? null;
    const occasion = payload.occasion ?? null;
    const confirmationCode =
      payload.confirmation_code ?? `SEAT-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const partySize = payload.party_size;

    const reservedAt = new Date(dateTime);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const resendKey = Deno.env.get("RESEND_API_KEY");
    const resend = resendKey ? new Resend(resendKey) : null;
    const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const twilioToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    const twilioFromPhone = Deno.env.get("TWILIO_PHONE_NUMBER");
    const twilioClient = twilioSid && twilioToken ? twilio(twilioSid, twilioToken) : null;

    let userProfileId: string | null = null;
    const authorization = req.headers.get("authorization");
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
    if (token) {
      const { data: authData } = await supabase.auth.getUser(token);
      const authUserId = authData.user?.id ?? null;
      if (authUserId) {
        const { data: profile } = await supabase
          .from("user_profiles")
          .select("id")
          .eq("auth_user_id", authUserId)
          .maybeSingle();
        userProfileId = profile?.id ?? null;
      }
    }

    try {
      await enforceRateLimit(supabase, "book", rateLimitIdentifier(req, userProfileId), {
        limit: 20,
        windowSeconds: 60,
      });
    } catch (e) {
      if (e instanceof RateLimitError) {
        return jsonResponse({ error: e.message, unavailable_reason: "rate_limited" }, 429);
      }
      throw e;
    }

    const { data: turnMinutesData, error: turnError } = await supabase.rpc("restaurant_turn_time_minutes", {
      p_restaurant_id: restaurantId,
      p_shift_id: shiftId,
    });
    if (turnError) return jsonResponse({ error: turnError.message }, 400);
    const turnMinutes = Number.isFinite(Number(turnMinutesData)) ? Number(turnMinutesData) : 90;

    const { data: shift, error: shiftError } = await supabase
      .from("shifts")
      .select("id, restaurant_id, min_party_size, max_party_size, max_covers")
      .eq("id", shiftId)
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true)
      .single();
    if (shiftError || !shift) {
      return jsonResponse({ error: "Shift not found for this restaurant." }, 400);
    }

    const { data: restaurant } = await supabase
      .from("restaurants")
      .select("id, name, slug, timezone, hours_json, phone")
      .eq("id", restaurantId)
      .maybeSingle();
    const restaurantPhone = typeof restaurant?.phone === "string" && restaurant.phone.trim()
      ? restaurant.phone.trim()
      : null;
    const restaurantName = typeof restaurant?.name === "string" && restaurant.name.trim()
      ? restaurant.name.trim()
      : "the restaurant";
    const restaurantSlug = typeof restaurant?.slug === "string" && restaurant.slug.trim()
      ? restaurant.slug.trim()
      : null;
    const localBookingDate = localDateForDateTime(reservedAt, restaurant?.timezone || "UTC");
    const closure = localBookingDate
      ? findClosedSpecialDayForDate(restaurant?.hours_json, localBookingDate)
      : null;
    if (closure) {
      return jsonResponse(
        { error: closureUnavailableMessage(closure), unavailable_reason: "closed" },
        409,
      );
    }

    const { data: floorCapacityData, error: floorCapacityError } = await supabase.rpc("restaurant_floor_capacity", {
      p_restaurant_id: restaurantId,
    });
    if (floorCapacityError) return jsonResponse({ error: floorCapacityError.message }, 400);
    const floorCapacity = Number.isFinite(Number(floorCapacityData)) ? Number(floorCapacityData) : 0;
    if (partySize > floorCapacity) {
      return jsonResponse(
        {
          error: floorCapacity > 0
            ? `This restaurant can take parties up to ${floorCapacity}.`
            : "This restaurant does not have a saved floor plan yet.",
          floor_capacity: floorCapacity,
        },
        409,
      );
    }

    const existingByEmail = guestEmail
      ? await supabase
        .from("reservations")
        .select("id, confirmation_code, duration_minutes")
        .eq("restaurant_id", restaurantId)
        .eq("reserved_at", reservedAt.toISOString())
        .eq("party_size", partySize)
        .eq("guest_email", guestEmail)
        .in("status", ["pending", "confirmed", "seated"])
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle()
      : { data: null };
    const existingByPhone = !existingByEmail.data && guestPhone
      ? await supabase
        .from("reservations")
        .select("id, confirmation_code, duration_minutes")
        .eq("restaurant_id", restaurantId)
        .eq("reserved_at", reservedAt.toISOString())
        .eq("party_size", partySize)
        .eq("guest_phone", guestPhone)
        .in("status", ["pending", "confirmed", "seated"])
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle()
      : { data: null };
    const existingContactReservation = existingByEmail.data ?? existingByPhone.data;
    if (existingContactReservation?.id) {
      const { data: existingOrder } = await supabase
        .from("orders")
        .select("id")
        .eq("reservation_id", existingContactReservation.id)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      return jsonResponse({
        reservation_id: existingContactReservation.id,
        order_id: existingOrder?.id ?? null,
        confirmation_code:
          typeof existingContactReservation.confirmation_code === "string" && existingContactReservation.confirmation_code.trim()
            ? existingContactReservation.confirmation_code
            : confirmationCode,
        table_ids: [],
        duration_minutes: Number(existingContactReservation.duration_minutes ?? turnMinutes),
        reused: true,
      });
    }

    const { data: canonicalGuestId, error: canonicalGuestError } = await supabase.rpc("canonical_guest_id", {
      p_restaurant_id: restaurantId,
      p_user_profile_id: userProfileId,
      p_email: guestEmail,
      p_phone: guestPhone,
    });
    if (canonicalGuestError) return jsonResponse({ error: `Guest lookup: ${canonicalGuestError.message}` }, 400);

    let guestId: string | null = typeof canonicalGuestId === "string" ? canonicalGuestId : null;

    const guestFields = {
      restaurant_id: restaurantId,
      user_profile_id: userProfileId,
      full_name: guestName,
      email: guestEmail,
      phone: guestPhone,
      dietary_restrictions: allergies ? allergies.split(",").map((value) => value.trim()).filter(Boolean) : [],
      seating_preference: seatingPreference,
    };
    if (!guestId) {
      const { data: newGuest, error: guestError } = await supabase
        .from("guests")
        .insert(guestFields)
        .select("id")
        .single();
      if (guestError) return jsonResponse({ error: `Guest: ${guestError.message}` }, 400);
      guestId = newGuest.id;
    } else {
      await supabase.from("guests").update(guestFields).eq("id", guestId);
    }

    const { data: existingReservation } = await supabase
      .from("reservations")
      .select("id, confirmation_code, duration_minutes")
      .eq("restaurant_id", restaurantId)
      .eq("guest_id", guestId)
      .eq("reserved_at", reservedAt.toISOString())
      .eq("party_size", partySize)
      .in("status", ["pending", "confirmed", "seated"])
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (existingReservation?.id) {
      const { data: existingOrder } = await supabase
        .from("orders")
        .select("id")
        .eq("reservation_id", existingReservation.id)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      return jsonResponse({
        reservation_id: existingReservation.id,
        order_id: existingOrder?.id ?? null,
        confirmation_code:
          typeof existingReservation.confirmation_code === "string" && existingReservation.confirmation_code.trim()
            ? existingReservation.confirmation_code
            : confirmationCode,
        table_ids: [],
        duration_minutes: Number(existingReservation.duration_minutes ?? turnMinutes),
        reused: true,
      });
    }

    // Diner double-book guard. Blocks a diner from holding two overlapping
    // reservations whether they're at the same restaurant or different ones.
    // Logged-in: matches by user_profile_id. Guest checkout: matches by phone
    // OR email. The exact-match idempotency check above already returns the
    // existing reservation when this is a re-submit of the same slot/party,
    // so reaching this guard means the new request is a genuinely different
    // booking that overlaps an existing one.
    {
      const idClauses: string[] = [];
      if (userProfileId) idClauses.push(`user_profile_id.eq.${userProfileId}`);
      if (guestEmail) idClauses.push(`guest_email.eq.${guestEmail}`);
      if (guestPhone) idClauses.push(`guest_phone.eq.${guestPhone}`);
      if (idClauses.length > 0) {
        const slotStart = reservedAt;
        const slotEnd = new Date(slotStart.getTime() + turnMinutes * 60_000);
        // Pad ±24h to capture timezone edges; we'll do exact overlap math below.
        const windowStart = new Date(slotStart.getTime() - 24 * 60 * 60_000).toISOString();
        const windowEnd = new Date(slotStart.getTime() + 24 * 60 * 60_000).toISOString();
        const { data: otherBookings } = await supabase
          .from("reservations")
          .select("id, restaurant_id, reserved_at, duration_minutes")
          .in("status", ["pending", "confirmed", "seated"])
          .gte("reserved_at", windowStart)
          .lte("reserved_at", windowEnd)
          .or(idClauses.join(","));
        const overlap = (otherBookings ?? []).find((row) => {
          const otherStart = new Date(row.reserved_at);
          const minutes = typeof row.duration_minutes === "number" && row.duration_minutes > 0
            ? row.duration_minutes
            : 90;
          const otherEnd = new Date(otherStart.getTime() + minutes * 60_000);
          return slotStart < otherEnd && otherStart < slotEnd;
        });
        if (overlap) {
          const sameRestaurant = overlap.restaurant_id === restaurantId;
          return jsonResponse(
            {
              error: sameRestaurant
                ? "You already have a reservation at this restaurant during that window. Please cancel or modify the existing one first."
                : "You already have a reservation at this time at another restaurant. Please cancel or modify that booking first.",
              unavailable_reason: "diner_double_book",
            },
            409,
          );
        }
      }
    }

    // Hold-conversion branch (CENAIVA_HOLDS_ENABLED). When the flag is on AND
    // the request carries a hold_id, convert the existing hold instead of
    // running book_reservation. The hold already owns the advisory lock /
    // table assignment / cover-cap recheck from when it was created, so this
    // path is purely a state transition + side-effect dispatch. No payment
    // intent is attached here — this endpoint is the no-payment path; the
    // payment-required path goes through confirm-hold-paid instead.
    const holdsEnabled = Deno.env.get("CENAIVA_HOLDS_ENABLED") === "true";
    const holdId = asUuid(payload.hold_id);

    if (holdsEnabled && holdId) {
      // p_grace_seconds: 0 — expired holds must not be convertible. The
      // RPC's default 120s grace creates a race where a fast diner can
      // book the same slot before the slow diner's expired hold gets
      // converted, then both reservations sit in the table with the
      // exclusion constraint only catching one. Zero grace forces the
      // slow diner to re-pick a slot if their hold expired, which is
      // the correct outcome.
      const { data: convertData, error: convertError } = await supabase.rpc(
        "convert_reservation_hold_to_reservation",
        { p_hold_id: holdId, p_payment_intent_id: null, p_grace_seconds: 0 },
      );
      if (convertError) {
        const code = (convertError as { code?: string }).code;
        if (code === "P0010") return jsonResponse({ error: "hold_not_found" }, 404);
        if (code === "P0011") {
          return jsonResponse(
            { error: "hold_expired", unavailable_reason: "hold_expired" },
            410,
          );
        }
        if (code === "P0012") return jsonResponse({ error: "hold_not_convertible" }, 409);
        if (code === "P0006" || code === "23P01") {
          return jsonResponse(
            { error: "diner_double_book", unavailable_reason: "diner_double_book" },
            409,
          );
        }
        console.error("convert_reservation_hold_to_reservation failed", convertError);
        return jsonResponse(
          { error: convertError.message ?? "conversion_failed" },
          500,
        );
      }
      const convertedRows = convertData as Array<{
        reservation_id: string;
        confirmation_code: string;
        table_ids: string[];
        duration_minutes: number;
        idempotent: boolean;
      }> | null;
      const row = convertedRows?.[0];
      if (!row) return jsonResponse({ error: "conversion_returned_empty" }, 500);

      // Post-conversion side effects (orders/items + promotion usage) — only
      // run on a fresh conversion; the idempotent path is a re-entry by the
      // same caller, so the side effects have already fired.
      if (!row.idempotent) {
        const { runPostHoldConversion } = await import("../_shared/hold-conversion.ts");
        await runPostHoldConversion({
          supabase,
          holdId,
          reservationId: row.reservation_id,
          paymentIntentId: null,
        });
        // Owner notification (fire-and-forget). Hold-conversion path doesn't
        // carry guest/party details in scope — query the reservation row for
        // them. Skip silently if the owner has the toggle off (the helper
        // handles preference + restaurants.email bypass internally).
        void (async () => {
          try {
            const { data: r } = await supabase
              .from("reservations")
              .select("restaurant_id, reserved_at, party_size, guest_full_name, confirmation_code")
              .eq("id", row.reservation_id)
              .maybeSingle();
            if (!r) return;
            await notifyOwnerNewReservation({
              supabase,
              restaurant_id: (r as any).restaurant_id,
              reservation_id: row.reservation_id,
              reserved_at: (r as any).reserved_at,
              party_size: (r as any).party_size,
              guest_full_name: (r as any).guest_full_name ?? null,
              confirmation_code: (r as any).confirmation_code ?? null,
            });
          } catch (err) {
            console.error("[create-public-booking.hold-convert] notifyOwnerNewReservation failed", err);
          }
        })();
      }

      // Deposit + split-tender on the hold-conversion path. Without this,
      // the fast path silently bypasses deposit-collection and split-tender
      // row insertion, leaving the booking with deposit_amount_cents=0 and
      // no reservation_deposit_payments rows — the diner pays nothing, the
      // settle trigger never flips to 'confirmed', and the restaurant is
      // unaware their party-4 booking has no deposit owed.
      let holdDepositCents = 0;
      {
        const { data: depositCents, error: depositError } = await supabase.rpc(
          "compute_deposit_for_party",
          { p_restaurant_id: restaurantId, p_party_size: partySize },
        );
        if (depositError) {
          console.error("[create-public-booking.hold-convert] compute_deposit_for_party failed", depositError);
        } else if (typeof depositCents === "number" && depositCents > 0) {
          holdDepositCents = depositCents;
          await supabase
            .from("reservations")
            .update({ deposit_amount_cents: depositCents, deposit_status: "pending" })
            .eq("id", row.reservation_id);
        }
      }

      let holdSplitTenderRowIds: string[] = [];
      if (payload.split_tender_payers) {
        const n = payload.split_tender_payers;
        const shareCentsOverride =
          typeof payload.split_tender_share_cents === "number"
            ? payload.split_tender_share_cents
            : null;
        const totalCents = shareCentsOverride !== null
          ? shareCentsOverride * n
          : holdDepositCents;
        if (totalCents > 0) {
          const baseShare = Math.floor(totalCents / n);
          const remainder = totalCents - baseShare * n;
          const shares = Array.from({ length: n }, (_, i) =>
            i === 0 ? baseShare + remainder : baseShare,
          );
          const { data: insertedRows, error: insertErr } = await supabase
            .from("reservation_deposit_payments")
            .insert(
              shares.map((amount_cents) => ({
                reservation_id: row.reservation_id,
                amount_cents,
                status: "pending",
                payer_email: asText(payload.guest_email) ?? null,
                payer_full_name: asText(payload.guest_name) ?? null,
              })),
            )
            .select("id");
          if (insertErr) {
            console.error("[create-public-booking.hold-convert] split-tender insert failed", insertErr);
          } else if (Array.isArray(insertedRows)) {
            holdSplitTenderRowIds = insertedRows
              .map((r) => (r as { id?: unknown }).id)
              .filter((id): id is string => typeof id === "string");
          }
          // Flip reservation to 'pending_payment' so the diner-side settle
          // trigger drives it to 'confirmed' once every share charges.
          await supabase
            .from("reservations")
            .update({ status: "pending_payment" })
            .eq("id", row.reservation_id);
        }
      }

      return jsonResponse({
        reservation_id: row.reservation_id,
        confirmation_code: row.confirmation_code,
        table_ids: row.table_ids,
        duration_minutes: row.duration_minutes,
        deposit_required: holdDepositCents > 0,
        deposit_amount_cents: holdDepositCents,
        split_tender_deposit_row_ids: holdSplitTenderRowIds,
      });
    }

    // Atomic booking: cover-cap re-check, table selection, reservation insert,
    // and reservation_tables insert all happen under a single advisory lock
    // keyed on (restaurant_id, reserved_at). Two concurrent callers for the
    // same slot serialize cleanly here. The exclusion constraint on
    // reservation_tables is the unbreakable backstop if the lock is somehow
    // bypassed (e.g. direct DB write).
    // Event / promotion linkage (2026-05-11). When the diner came in via the
    // /deals event/promotion card, the URL pre-fills `event_id` /
    // `promotion_id` and we forward those to book_reservation so the
    // reservation row is tagged + appears under the right event's attendees
    // list on the owner dashboard.
    const reservationEventId = asUuid(payload.event_id);
    const reservationPromotionId = asUuid(payload.promotion_id);
    const reservationPromoCode = asText(payload.applied_promo_code) ?? null;
    const { data: bookingRows, error: bookingError } = await supabase.rpc("book_reservation", {
      p_restaurant_id: restaurantId,
      p_shift_id: shiftId,
      p_reserved_at: reservedAt.toISOString(),
      p_party_size: partySize,
      p_turn_minutes: turnMinutes,
      p_guest_id: guestId,
      p_user_profile_id: userProfileId,
      p_confirmation_code: confirmationCode,
      p_source: "web",
      p_special_request: allergies,
      p_dietary_notes: allergies,
      p_occasion: occasion,
      p_is_guest_checkout: !userProfileId,
      p_guest_full_name: guestName,
      p_guest_email: guestEmail,
      p_guest_phone: guestPhone,
      p_event_id: reservationEventId,
      p_promotion_id: reservationPromotionId,
      p_applied_promo_code: reservationPromoCode,
      // Web bookings are confirmed at creation. Deposit-required parties are
      // hand-offed pre-RPC by the orchestrator and pre-form by the public
      // page, so by the time we reach book_reservation, the booking is
      // ready to go. Without p_status='confirmed', the RPC default is
      // 'pending' and the diner sees an ambiguous "not yet confirmed"
      // state on /bookings.
      //
      // Split-tender exception (2026-05-20): when N payers are sharing the
      // deposit, the reservation must stay 'pending_payment' until all N
      // deposit rows are charged. The settle trigger on
      // reservation_deposit_payments flips it to 'confirmed' once the last
      // row settles.
      p_status: payload.split_tender_payers ? "pending_payment" : "confirmed",
    });

    if (bookingError) {
      const code = (bookingError as { code?: string }).code;
      if (code === "P0001") {
        return jsonResponse(
          { error: "This time was just taken. Please pick another slot.", unavailable_reason: "slot_taken" },
          409,
        );
      }
      if (code === "P0002") {
        return jsonResponse({ error: "This time no longer has enough cover capacity.", unavailable_reason: "over_cover_cap" }, 409);
      }
      if (code === "P0003") {
        return jsonResponse({ error: "Shift not found for this restaurant." }, 400);
      }
      // P0006 raised by book_reservation when the same diner already has an
      // overlapping active reservation. 23P01 is the partial-exclusion
      // constraint backstop covering the same condition; map both to the
      // same diner_double_book response.
      if (code === "P0006" || code === "23P01") {
        return jsonResponse(
          {
            error: "You already have a reservation at this time. Cancel or modify the existing one before booking again.",
            unavailable_reason: "diner_double_book",
          },
          409,
        );
      }
      if (code === "P0007") {
        return jsonResponse(
          {
            error: "Please provide a name and email or phone to complete your booking.",
            unavailable_reason: "missing_identifier",
          },
          400,
        );
      }
      if (code === "P0008") {
        return jsonResponse(
          {
            error: "This time is past the shift's close. Pick an earlier slot.",
            unavailable_reason: "past_shift_close",
          },
          409,
        );
      }
      return jsonResponse({ error: `Reservation: ${bookingError.message}` }, 400);
    }

    const bookingRow = Array.isArray(bookingRows) ? bookingRows[0] : bookingRows;
    if (!bookingRow?.reservation_id) {
      return jsonResponse({ error: "Booking failed: no reservation returned." }, 500);
    }
    const reservationId = bookingRow.reservation_id as string;
    const savedConfirmationCode =
      typeof bookingRow.confirmation_code === "string" && bookingRow.confirmation_code.trim()
        ? bookingRow.confirmation_code
        : confirmationCode;
    const assignedTableIds = Array.isArray(bookingRow.table_ids)
      ? (bookingRow.table_ids as unknown[]).filter((id): id is string => typeof id === "string")
      : [];

    // Deposit policy: if the party crosses any tier, mark the reservation as
    // 'pending' until the customer settles the deposit. The trigger on
    // reservation_deposit_payments flips it to 'confirmed' once every payment
    // row is 'charged'. STRIPE STUB — replace with real charge once Stripe is wired.
    let depositAmountCents = 0;
    {
      const { data: depositCents, error: depositError } = await supabase.rpc(
        "compute_deposit_for_party",
        { p_restaurant_id: restaurantId, p_party_size: partySize },
      );
      if (depositError) {
        console.error("compute_deposit_for_party failed", depositError);
      } else if (typeof depositCents === "number" && depositCents > 0) {
        depositAmountCents = depositCents;
        await supabase
          .from("reservations")
          .update({ deposit_amount_cents: depositCents, deposit_status: "pending" })
          .eq("id", reservationId);
      }
    }

    // Split-tender deposit rows (2026-05-20, extended 2026-05-23).
    // When the diner picked "Split tender", we create N
    // reservation_deposit_payments rows — each `pending` until
    // SplitTenderPaymentForm charges them via the standard
    // create-public-payment-intent + confirm-deposit-paid path (with strict
    // deposit_payment_ids metadata check). The settle trigger flips the
    // reservation to 'confirmed' (and any linked pre-order to 'paid') once
    // every row is 'charged'.
    //
    // 2026-05-23: row totals can now derive from `split_tender_share_cents`
    // (per-payer cents incl. preorder + tax + deposit). Falls back to legacy
    // deposit-only split when only `depositAmountCents > 0`. This makes
    // pre-order split-tender work even when the party doesn't trigger a
    // deposit. We give the first payer the rounding remainder so the sum
    // matches the diner's total exactly.
    let splitTenderDepositRowIds: string[] = [];
    if (payload.split_tender_payers) {
      const n = payload.split_tender_payers;
      const shareCentsOverride =
        typeof payload.split_tender_share_cents === "number"
          ? payload.split_tender_share_cents
          : null;
      const totalCents = shareCentsOverride !== null
        ? shareCentsOverride * n
        : depositAmountCents;
      if (totalCents > 0) {
        const baseShare = Math.floor(totalCents / n);
        const remainder = totalCents - baseShare * n;
        const shares = Array.from({ length: n }, (_, i) =>
          i === 0 ? baseShare + remainder : baseShare,
        );
        // payer_email/full_name required by the check constraint
        // `reservation_deposit_payments_payer_required` — at minimum one
        // payer identity field. We stamp the booking diner on the first
        // row; co-payers will be filled in by their own card-entry flow.
        const { data: insertedRows, error: insertErr } = await supabase
          .from("reservation_deposit_payments")
          .insert(
            shares.map((amount_cents) => ({
              reservation_id: reservationId,
              amount_cents,
              status: "pending",
              payer_email: asText(payload.guest_email) ?? null,
              payer_full_name: asText(payload.guest_name) ?? null,
            })),
          )
          .select("id");
        if (insertErr) {
          console.error("[split-tender] deposit row insert failed", insertErr);
        } else if (Array.isArray(insertedRows)) {
          splitTenderDepositRowIds = insertedRows
            .map((r) => (r as { id?: unknown }).id)
            .filter((id): id is string => typeof id === "string");
        }
      }
    }

    let orderId: string | null = null;
    const cartItems = normalizeCartItems(payload.cart_items);
    if (cartItems.length > 0) {
      const { data: order, error: orderError } = await supabase
        .from("orders")
        .insert({
          restaurant_id: restaurantId,
          reservation_id: reservationId,
          guest_id: guestId,
          is_preorder: true,
          order_type: "dine_in",
          status: "pending",
          subtotal: roundMoney(payload.subtotal),
          tax_amount: roundMoney(payload.tax_amount),
          tip_amount: roundMoney(payload.tip_amount),
          total_amount: roundMoney(payload.total_amount),
          discount_amount: roundMoney(payload.discount_amount) > 0 ? roundMoney(payload.discount_amount) : null,
          discount_reason: asText(payload.discount_reason),
          promotion_id: asUuid(payload.promotion_id),
          payment_method: asText(payload.payment_method) ?? "card",
          confirmation_code: savedConfirmationCode,
          source: "web",
        })
        .select("id")
        .single();
      if (orderError) return jsonResponse({ error: `Order: ${orderError.message}` }, 400);
      orderId = order.id as string;

      const { error: itemsError } = await supabase
        .from("order_items")
        .insert(cartItems.map((item) => ({ ...item, order_id: orderId, status: "pending" })));
      if (itemsError) {
        await supabase
          .from("orders")
          .update({ status: "cancelled" })
          .eq("id", orderId);
        return jsonResponse({ error: `Order items: ${itemsError.message}` }, 400);
      }
    }

    const promotionId = asUuid(payload.promotion_id);
    if (promotionId) {
      const { data: promo } = await supabase
        .from("promotions")
        .select("current_uses")
        .eq("id", promotionId)
        .eq("restaurant_id", restaurantId)
        .maybeSingle();
      if (promo) {
        await supabase
          .from("promotions")
          .update({ current_uses: Number(promo.current_uses ?? 0) + 1 })
          .eq("id", promotionId);
      }
    }

    const reservationDateLabel = formatReservationDate(reservedAt);
    const confirmationSubject = `Your reservation at ${restaurantName}`;
    // Include email in the URL so the guest cancel/modify path can re-prove
    // identity without re-entering it (2026-05-22 security hardening).
    const manageLink = restaurantSlug && savedConfirmationCode
      ? `https://cenaiva.com/${restaurantSlug}?confirmation=${encodeURIComponent(savedConfirmationCode)}${guestEmail ? `&email=${encodeURIComponent(guestEmail)}` : ""}`
      : null;
    // Enrich the SMS body with event/promo context so diners see what they
    // actually booked. Mirrors the same enrichment in _shared/booking.ts.
    let eventLine = "";
    let promoLine = "";
    if (reservationEventId) {
      const { data: ev } = await supabase
        .from("events").select("name").eq("id", reservationEventId).maybeSingle();
      if (ev?.name) eventLine = ` Event: ${ev.name}.`;
    }
    if (reservationPromotionId) {
      const { data: pr } = await supabase
        .from("promotions").select("title, promo_code").eq("id", reservationPromotionId).maybeSingle();
      if (pr?.title) {
        const codePart = pr.promo_code ? ` (code ${pr.promo_code})` : "";
        promoLine = ` Promo: ${pr.title}${codePart}.`;
      }
    } else if (reservationPromoCode) {
      promoLine = ` Promo code: ${reservationPromoCode}.`;
    }
    const guestLabel = partySize === 1 ? "guest" : "guests";
    // Phase 11 (2026-05-15): multi-line confirmation body. The blank line
    // after the booking summary separates the body from the confirmation
    // code block; another blank line separates code+manage from the
    // recovery hint + restaurant phone. Renders cleanly in both SMS
    // (Twilio preserves \n) and email plaintext bodies.
    const restaurantPhoneLine = restaurantPhone
      ? `\nNeed to reach the restaurant directly? Call ${restaurantPhone}.`
      : "";
    const confirmationBody =
      `Hi ${guestName},\n\n` +
      `Your table at ${restaurantName} is booked for ${partySize} ${guestLabel} on ${reservationDateLabel}.` +
      eventLine + promoLine + `\n\n` +
      `Confirmation code: ${savedConfirmationCode}\n` +
      (manageLink ? `Manage or cancel: ${manageLink}\n` : "") +
      `\nLost this message? Visit https://cenaiva.com/find-reservation` +
      restaurantPhoneLine;
    let confirmationChannel: "email" | "sms" | null = null;
    let confirmationStatus: "sent" | "skipped" | "failed" = "skipped";

    const smsToPhone = normalizeNorthAmericanPhone(guestPhone);
    if (smsToPhone && twilioClient && twilioFromPhone) {
      if (await isPhoneOptedOut(supabase, smsToPhone)) {
        console.log(
          `[create-public-booking] phone opted out, skipping SMS to ${smsToPhone.slice(-4)}`,
        );
        // fall through to email
      } else {
        try {
          await twilioClient.messages.create({
            body: confirmationBody,
            from: twilioFromPhone,
            to: smsToPhone,
          });
          confirmationChannel = "sms";
          confirmationStatus = "sent";
        } catch (err) {
          console.error("Reservation confirmation SMS failed", err);
          confirmationChannel = "sms";
          confirmationStatus = "failed";
        }
      }
    }

    if (confirmationStatus !== "sent" && guestEmail && resend) {
      try {
        await resend.emails.send({
          from: Deno.env.get("RESEND_FROM_EMAIL") ?? "Cenaiva <noreply@cenaiva.com>",
          to: guestEmail,
          subject: confirmationSubject,
          text: confirmationBody,
        });
        confirmationChannel = "email";
        confirmationStatus = "sent";
      } catch (err) {
        console.error("Reservation confirmation email failed", err);
        confirmationChannel = "email";
        confirmationStatus = "failed";
      }
    }

    if (confirmationChannel) {
      await supabase.from("communication_log").insert({
        guest_id: guestId,
        restaurant_id: restaurantId,
        channel: confirmationChannel,
        type: "reservation_confirmation",
        subject: confirmationSubject,
        body: confirmationBody,
        status: confirmationStatus,
        sent_at: confirmationStatus === "sent" ? new Date().toISOString() : null,
        campaign_id: reservationId,
      });
    }

    // Owner notification (fire-and-forget). Honors the owner's
    // notification_preferences_json.new_reservation_email toggle internally
    // — no need to gate here. Goes to the owner's user_profile.email, never
    // restaurants.email (the shared inbox).
    void notifyOwnerNewReservation({
      supabase,
      restaurant_id: restaurantId,
      reservation_id: reservationId,
      reserved_at: reservedAt.toISOString(),
      party_size: partySize,
      guest_full_name: guestName,
      confirmation_code: savedConfirmationCode,
    }).catch((err) => {
      console.error("[create-public-booking] notifyOwnerNewReservation failed", err);
    });

    return jsonResponse({
      reservation_id: reservationId,
      order_id: orderId,
      confirmation_code: savedConfirmationCode,
      table_ids: assignedTableIds,
      duration_minutes: turnMinutes,
      confirmation_delivery: confirmationStatus,
      confirmation_delivery_channel: confirmationChannel,
      deposit_amount_cents: depositAmountCents,
      deposit_required: depositAmountCents > 0,
      split_tender_deposit_row_ids: splitTenderDepositRowIds,
    });
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
