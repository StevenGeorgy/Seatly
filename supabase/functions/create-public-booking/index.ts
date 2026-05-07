import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Resend } from "npm:resend@4.0.0";
import twilio from "npm:twilio@5.0.0";
import {
  closureUnavailableMessage,
  findClosedSpecialDayForDate,
  localDateForDateTime,
} from "../_shared/closures.ts";

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

type BookingPayload = {
  restaurant_id?: unknown;
  date_time?: unknown;
  shift_id?: unknown;
  party_size?: unknown;
  guest_name?: unknown;
  guest_email?: unknown;
  guest_phone?: unknown;
  allergies?: unknown;
  seating_preference?: unknown;
  occasion?: unknown;
  confirmation_code?: unknown;
  cart_items?: CartItemInput[];
  subtotal?: unknown;
  tax_amount?: unknown;
  tip_amount?: unknown;
  total_amount?: unknown;
  discount_amount?: unknown;
  discount_reason?: unknown;
  promotion_id?: unknown;
  payment_method?: unknown;
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

function normalizeEmail(value: string | null): string | null {
  return value ? value.trim().toLowerCase() : null;
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
    const payload = (await req.json().catch(() => ({}))) as BookingPayload;
    const restaurantId = asUuid(payload.restaurant_id);
    const shiftId = asUuid(payload.shift_id);
    const dateTime = asText(payload.date_time);
    const guestName = asText(payload.guest_name);
    const guestEmail = normalizeEmail(asText(payload.guest_email));
    const guestPhone = asText(payload.guest_phone);
    const allergies = asText(payload.allergies);
    const seatingPreference = asText(payload.seating_preference);
    const occasion = asText(payload.occasion);
    const confirmationCode =
      asText(payload.confirmation_code) ?? `SEAT-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const partySize = Math.max(1, Math.floor(asNumber(payload.party_size, 1)));

    if (!restaurantId || !shiftId || !dateTime || !guestName || !guestEmail) {
      return jsonResponse({ error: "restaurant_id, shift_id, date_time, guest_name, and guest_email are required." }, 400);
    }

    const reservedAt = new Date(dateTime);
    if (Number.isNaN(reservedAt.getTime())) {
      return jsonResponse({ error: "date_time must be a valid ISO timestamp." }, 400);
    }

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
      .select("id, name, slug, timezone, hours_json")
      .eq("id", restaurantId)
      .maybeSingle();
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

    const maxCovers = shift.max_covers ?? 100;
    const slotStart = reservedAt;
    const slotEnd = new Date(slotStart.getTime() + turnMinutes * 60_000);
    const dayStart = new Date(slotStart);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(slotStart);
    dayEnd.setUTCHours(23, 59, 59, 999);
    const { data: overlappingReservations } = await supabase
      .from("reservations")
      .select("reserved_at, party_size, duration_minutes")
      .eq("restaurant_id", restaurantId)
      .eq("shift_id", shiftId)
      .in("status", ["pending", "confirmed", "seated"])
      .gte("reserved_at", dayStart.toISOString())
      .lte("reserved_at", dayEnd.toISOString());
    const totalCovers = (overlappingReservations ?? []).reduce((total: number, reservation) => {
      const reservationStart = new Date(reservation.reserved_at);
      const reservationEnd = new Date(
        reservationStart.getTime() + Number(reservation.duration_minutes ?? turnMinutes) * 60_000,
      );
      if (slotStart < reservationEnd && slotEnd > reservationStart) {
        return total + Number(reservation.party_size ?? 0);
      }
      return total;
    }, partySize);
    if (totalCovers > maxCovers) {
      return jsonResponse({ error: "This time no longer has enough cover capacity." }, 409);
    }

    const { data: tableIds, error: tableLookupError } = await supabase.rpc("find_available_table_group", {
      p_restaurant_id: restaurantId,
      p_reserved_at: reservedAt.toISOString(),
      p_party_size: partySize,
      p_turn_minutes: turnMinutes,
    });
    const availableTableIds = Array.isArray(tableIds)
      ? tableIds.filter((id): id is string => typeof id === "string")
      : [];
    if (tableLookupError || availableTableIds.length === 0) {
      return jsonResponse(
        { error: tableLookupError?.message ?? "No available table can fit this party at that time." },
        409,
      );
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

    const { data: reservation, error: reservationError } = await supabase
      .from("reservations")
      .insert({
        restaurant_id: restaurantId,
        guest_id: guestId,
        user_profile_id: userProfileId,
        shift_id: shiftId,
        party_size: partySize,
        reserved_at: reservedAt.toISOString(),
        duration_minutes: turnMinutes,
        status: "pending",
        source: "web",
        confirmation_code: confirmationCode,
        special_request: allergies,
        dietary_notes: allergies,
        occasion,
        is_guest_checkout: !userProfileId,
        guest_full_name: guestName,
        guest_email: guestEmail,
        guest_phone: guestPhone,
      })
      .select("id, confirmation_code")
      .single();
    if (reservationError) {
      return jsonResponse({ error: `Reservation: ${reservationError.message}` }, 400);
    }

    const reservationId = reservation.id as string;
    const savedConfirmationCode =
      typeof reservation.confirmation_code === "string" && reservation.confirmation_code.trim()
        ? reservation.confirmation_code
        : confirmationCode;
    const { data: assignedIds, error: assignmentError } = await supabase.rpc("assign_reservation_tables", {
      p_reservation_id: reservationId,
      p_restaurant_id: restaurantId,
      p_reserved_at: reservedAt.toISOString(),
      p_party_size: partySize,
      p_turn_minutes: turnMinutes,
    });
    const assignedTableIds = Array.isArray(assignedIds)
      ? assignedIds.filter((id): id is string => typeof id === "string")
      : [];
    if (assignmentError || assignedTableIds.length === 0) {
      await supabase
        .from("reservations")
        .update({
          status: "cancelled",
          cancelled_at: new Date().toISOString(),
          cancellation_reason: "No available table for party size.",
        })
        .eq("id", reservationId);
      return jsonResponse(
        { error: assignmentError?.message ?? "No available table can fit this party at that time." },
        409,
      );
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
    const manageLink = restaurantSlug && savedConfirmationCode
      ? `https://cenaiva.com/${restaurantSlug}?confirmation=${encodeURIComponent(savedConfirmationCode)}`
      : null;
    const confirmationBody =
      `Hi ${guestName}, your table at ${restaurantName} is booked for ${partySize} ` +
      `${partySize === 1 ? "guest" : "guests"} on ${reservationDateLabel}. ` +
      `Confirmation code: ${savedConfirmationCode}.` +
      (manageLink ? ` Manage: ${manageLink}` : "");
    let confirmationChannel: "email" | "sms" | null = null;
    let confirmationStatus: "sent" | "skipped" | "failed" = "skipped";

    const smsToPhone = normalizeNorthAmericanPhone(guestPhone);
    if (smsToPhone && twilioClient && twilioFromPhone) {
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

    return jsonResponse({
      reservation_id: reservationId,
      order_id: orderId,
      confirmation_code: savedConfirmationCode,
      table_ids: assignedTableIds,
      duration_minutes: turnMinutes,
      confirmation_delivery: confirmationStatus,
      confirmation_delivery_channel: confirmationChannel,
    });
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
