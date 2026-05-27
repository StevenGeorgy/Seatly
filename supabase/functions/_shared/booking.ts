import { supabaseAdmin } from "./supabase.ts";
import {
  isMinuteInsideWindow,
  localBookingParts,
  resolveRestaurantHoursForDate,
} from "./hours.ts";
import {
  DEFAULT_CURRENCY,
  DEFAULT_TIMEZONE,
  DEFAULT_TAX_RATE_FALLBACK,
} from "./booking-defaults.ts";
import { makeConfirmationCode } from "./confirmation-code.ts";
import {
  buildConfirmationBody,
  formatReservationDate,
  sendReservationNotification,
} from "./reservation-notifications.ts";
import { notifyOwnerNewReservation } from "./owner-notifications.ts";

export interface BookingItem {
  menu_item_id: string;
  name: string;
  quantity: number;
  unit_price: number;
  modifications?: string | null;
}

export interface CompleteBookingParams {
  user_profile_id: string;
  restaurant_id: string;
  order_type: "dine_in";
  // Dine-in fields
  date_time?: string | null; // UTC ISO
  shift_id?: string | null;
  party_size?: number | null;
  // Guest info (override from user profile if provided)
  guest_name?: string | null;
  guest_email?: string | null;
  guest_phone?: string | null;
  // Post-booking details
  special_request?: string | null;
  occasion?: string | null;
  seating_preference?: string | null;
  // Event / promotion linkage — when the user books FOR a specific event
  // or applies a promo code, these get persisted on the reservation row.
  // The book_reservation RPC validates event capacity, event time window,
  // and rejects normal bookings during a private-event buyout.
  event_id?: string | null;
  promotion_id?: string | null;
  applied_promo_code?: string | null;
  // Order items (optional for pure reservations)
  items?: BookingItem[];
  notes?: string | null;
}

export interface CompleteBookingResult {
  success: boolean;
  confirmation_code: string;
  order_type: string;
  reservation_id: string | null;
  order_id: string | null;
  guest_id: string | null;
  subtotal: number;
  tax: number;
  total: number;
  currency: string;
  checkout_url: string | null;
  error?: string;
}

function n2(n: number) {
  return Math.round(n * 100) / 100;
}

function failureResult(
  order_type: CompleteBookingParams["order_type"],
  error: string,
  guest_id: string | null = null,
): CompleteBookingResult {
  return {
    success: false,
    confirmation_code: "",
    order_type,
    reservation_id: null,
    order_id: null,
    guest_id,
    subtotal: 0,
    tax: 0,
    total: 0,
    currency: DEFAULT_CURRENCY,
    checkout_url: null,
    error,
  };
}

export async function completeBooking(
  params: CompleteBookingParams,
): Promise<CompleteBookingResult> {
  const {
    user_profile_id,
    restaurant_id,
    order_type,
    date_time,
    shift_id,
    party_size,
    items = [],
    guest_name,
    guest_email,
    guest_phone,
    special_request,
    occasion,
    seating_preference,
    event_id,
    promotion_id,
    applied_promo_code,
    notes,
  } = params;

  // Dine-in validation (dine_in is the only supported type)
  if (!date_time || !shift_id || !party_size) {
    return failureResult(order_type, "date_time, shift_id, and party_size are required.");
  }

  const { data: restaurantForBooking, error: restaurantErr } = await supabaseAdmin
    .from("restaurants")
    .select("timezone, hours_json")
    .eq("id", restaurant_id)
    .single();
  if (restaurantErr) {
    return failureResult(order_type, `Restaurant lookup failed: ${restaurantErr.message}`);
  }

  const timezone = restaurantForBooking?.timezone || DEFAULT_TIMEZONE;
  const localParts = localBookingParts(date_time, timezone);
  if (!localParts) {
    return failureResult(order_type, "Invalid reservation date_time.");
  }

  const hoursJson =
    restaurantForBooking?.hours_json && typeof restaurantForBooking.hours_json === "object"
      ? (restaurantForBooking.hours_json as Record<string, unknown>)
      : null;
  const configuredHours = resolveRestaurantHoursForDate(
    hoursJson,
    localParts.dateOnly,
    localParts.dayOfWeek,
  );
  if (configuredHours.closed) {
    return failureResult(order_type, "Restaurant is closed on that date.");
  }
  if (configuredHours.window && !isMinuteInsideWindow(localParts.timeMinutes, configuredHours.window)) {
    return failureResult(order_type, "Requested reservation time is outside restaurant hours.");
  }

  // Load user profile for fallback guest fields
  const { data: userProfile } = await supabaseAdmin
    .from("user_profiles")
    .select("full_name, email, phone, allergies, dietary_restrictions, seating_preference, noise_preference")
    .eq("id", user_profile_id)
    .single();

  // Find or create guest record for this restaurant
  const { data: existingGuest } = await supabaseAdmin
    .from("guests")
    .select("id")
    .eq("restaurant_id", restaurant_id)
    .eq("user_profile_id", user_profile_id)
    .maybeSingle();

  const guestFields = {
    full_name: guest_name ?? userProfile?.full_name ?? "Guest",
    email: guest_email ?? userProfile?.email ?? "",
    phone: guest_phone ?? userProfile?.phone ?? "",
    ...(userProfile?.dietary_restrictions?.length
      ? { dietary_restrictions: userProfile.dietary_restrictions }
      : {}),
    ...(userProfile?.allergies?.length ? { allergies: userProfile.allergies } : {}),
    ...(seating_preference ?? userProfile?.seating_preference
      ? { seating_preference: seating_preference ?? userProfile?.seating_preference }
      : {}),
    ...(userProfile?.noise_preference
      ? { noise_preference: userProfile.noise_preference }
      : {}),
  };

  let guestId = existingGuest?.id as string | undefined;
  if (!guestId) {
    const { data: newGuest, error: guestErr } = await supabaseAdmin
      .from("guests")
      .insert({ restaurant_id, user_profile_id, ...guestFields })
      .select("id")
      .single();
    if (guestErr) {
      return {
        success: false,
        confirmation_code: "",
        order_type,
        reservation_id: null,
        order_id: null,
        guest_id: null,
        subtotal: 0,
        tax: 0,
        total: 0,
        currency: DEFAULT_CURRENCY,
        checkout_url: null,
        error: `Guest creation failed: ${guestErr.message}`,
      };
    }
    guestId = newGuest.id;
  } else {
    await supabaseAdmin.from("guests").update(guestFields).eq("id", guestId);
  }

  const confirmationCode = makeConfirmationCode();

  // Atomic write via book_reservation RPC. CLAUDE.md hard rule: never bypass
  // book_reservation for reservation writes — it owns the advisory lock,
  // cover-cap recheck, diner-overlap pre-check (P0006), close-time guard
  // (P0008), and identifier guard (P0007). Direct INSERTs trip the partial
  // exclusion constraints with the opaque 23P01 — users see a server error
  // instead of "you already have a reservation". The RPC also returns the
  // trigger-overridden confirmation_code so the value we report matches the
  // row that was actually persisted.
  const { data: turnMinutesData } = await supabaseAdmin.rpc(
    "restaurant_turn_time_minutes",
    { p_restaurant_id: restaurant_id },
  );
  const turnMinutes = Number.isFinite(Number(turnMinutesData))
    ? Number(turnMinutesData)
    : 90;

  // Hold-fork (CENAIVA_HOLDS_ENABLED). When the flag is on AND payment is
  // required (deposit > 0 OR there's a preorder cart), create a hold row
  // instead of writing the reservation directly. The caller (voice
  // orchestrator) reads `requires_payment_url` and hands the diner off to
  // the public restaurant page's checkout, which calls
  // create-public-payment-intent with the hold_id and then confirm-hold-paid
  // after Stripe succeeds.
  const holdsEnabled = Deno.env.get("CENAIVA_HOLDS_ENABLED") === "true";
  const { data: holdDepositCents } = holdsEnabled
    ? await supabaseAdmin.rpc("compute_deposit_for_party", {
      p_restaurant_id: restaurant_id,
      p_party_size: party_size,
    })
    : { data: null };
  const depositCentsForHold =
    typeof holdDepositCents === "number" && holdDepositCents > 0 ? holdDepositCents : 0;
  const paymentRequired = depositCentsForHold > 0 || items.length > 0;

  if (holdsEnabled && paymentRequired) {
    // Look up the slug for the hand-off URL.
    const { data: slugRow } = await supabaseAdmin
      .from("restaurants")
      .select("slug")
      .eq("id", restaurant_id)
      .maybeSingle();
    const slug = (slugRow as { slug: string | null } | null)?.slug ?? null;

    const { data: holdRows, error: holdError } = await supabaseAdmin.rpc(
      "create_reservation_hold",
      {
        p_restaurant_id: restaurant_id,
        p_shift_id: shift_id,
        p_reserved_at: date_time,
        p_party_size: party_size,
        p_turn_minutes: turnMinutes,
        p_confirmation_code: confirmationCode,
        p_source: "cenaiva",
        p_user_profile_id: user_profile_id,
        p_guest_id: guestId,
        p_guest_full_name: guestFields.full_name,
        p_guest_email: guestFields.email,
        p_guest_phone: guestFields.phone,
        p_event_id: event_id ?? null,
        p_promotion_id: promotion_id ?? null,
        p_applied_promo_code: applied_promo_code ?? null,
        p_hold_minutes: 30,
      },
    );
    if (holdError) {
      const code = (holdError as { code?: string }).code;
      const message = (holdError as { message?: string }).message ?? "";
      const friendly =
        code === "P0001"
          ? "That time was just taken. Please pick another slot."
          : code === "P0002"
            ? "That time no longer has cover capacity."
            : code === "P0006" || code === "23P01"
              ? "You already have a reservation at that time."
              : `Hold creation failed: ${message}`;
      return failureResult(order_type, friendly, guestId ?? null);
    }
    const holdRow = Array.isArray(holdRows) ? holdRows[0] : holdRows;
    if (!holdRow?.hold_id) {
      return failureResult(order_type, "Hold creation failed: no hold returned.", guestId ?? null);
    }
    const handoffUrl = slug
      ? `https://cenaiva.com/${slug}/checkout?hold=${holdRow.hold_id}`
      : null;
    // Use the failure-shape fields we don't normally populate to carry the
    // hold metadata back to the voice orchestrator without changing the
    // CompleteBookingResult schema. The orchestrator checks
    // `checkout_url` (re-purposed as the hand-off URL) and reads
    // `confirmation_code` for the spoken response.
    return {
      success: true,
      confirmation_code: holdRow.confirmation_code ?? confirmationCode,
      order_type,
      reservation_id: null,
      order_id: null,
      guest_id: guestId ?? null,
      subtotal: 0,
      tax: 0,
      total: 0,
      currency: DEFAULT_CURRENCY,
      checkout_url: handoffUrl,
      // Extra fields beyond CompleteBookingResult — tolerated by callers.
      hold_id: holdRow.hold_id,
      requires_payment_url: handoffUrl,
      expires_at: holdRow.expires_at,
    } as CompleteBookingResult & {
      hold_id: string;
      requires_payment_url: string | null;
      expires_at: string;
    };
  }

  let reservationId: string | null = null;
  let persistedConfirmationCode = confirmationCode;
  const { data: bookingRows, error: resvErr } = await supabaseAdmin.rpc(
    "book_reservation",
    {
      p_restaurant_id: restaurant_id,
      p_shift_id: shift_id,
      p_reserved_at: date_time,
      p_party_size: party_size,
      p_turn_minutes: turnMinutes,
      p_guest_id: guestId,
      p_user_profile_id: user_profile_id,
      p_confirmation_code: confirmationCode,
      p_source: "cenaiva",
      p_special_request: special_request ?? null,
      p_dietary_notes: null,
      p_occasion: occasion ?? null,
      p_is_guest_checkout: false,
      p_guest_full_name: guestFields.full_name,
      p_guest_email: guestFields.email,
      p_guest_phone: guestFields.phone,
      // Voice (Cenaiva) bookings are confirmed immediately — the
      // orchestrator's preflight rejects deposit-required parties via
      // the public-page hand-off, so any booking that reaches this point
      // is a no-deposit booking. Without this, book_reservation defaults
      // to 'pending' and the UI shows the booking as not-yet-confirmed.
      p_status: "confirmed",
      // Event / promotion linkage (2026-05-11). When the user is booking
      // for a specific event ("the wine pairing on Saturday") or applies
      // a promo code, the RPC persists these on the reservation row and
      // also runs event-capacity + private-event-buyout safety checks.
      p_event_id: event_id ?? null,
      p_promotion_id: promotion_id ?? null,
      p_applied_promo_code: applied_promo_code ?? null,
    },
  );
  if (resvErr) {
    const code = (resvErr as { code?: string }).code;
    const message = (resvErr as { message?: string }).message ?? "";
    // 23P01 (exclusion constraint) can come from TWO different constraints:
    //   - reservations_user_no_overlap / _email_no_overlap / _phone_no_overlap
    //     (diner-double-book)  → user-facing reason, same as P0006
    //   - reservation_tables_no_overlap (the table-assignment constraint)
    //     → not a diner conflict, the slot itself is taken
    const tableLevelOverlap =
      code === "23P01" && /reservation_tables_no_overlap/i.test(message);
    const friendly =
      code === "P0001" || tableLevelOverlap
        ? "That time was just taken. Please pick another slot."
        : code === "P0002"
          ? "That time no longer has cover capacity."
          : code === "P0006" || code === "23P01"
            ? "You already have a reservation at that time."
            : code === "P0007"
              ? "Need a name and email or phone to book."
              : code === "P0008"
                ? "That time is past the shift's close."
                : `Reservation failed: ${resvErr.message}`;
    return {
      success: false,
      confirmation_code: "",
      order_type,
      reservation_id: null,
      order_id: null,
      guest_id: guestId ?? null,
      subtotal: 0,
      tax: 0,
      total: 0,
      currency: DEFAULT_CURRENCY,
      checkout_url: null,
      error: friendly,
    };
  }
  const bookingRow = Array.isArray(bookingRows) ? bookingRows[0] : bookingRows;
  if (!bookingRow?.reservation_id) {
    return {
      success: false,
      confirmation_code: "",
      order_type,
      reservation_id: null,
      order_id: null,
      guest_id: guestId ?? null,
      subtotal: 0,
      tax: 0,
      total: 0,
      currency: DEFAULT_CURRENCY,
      checkout_url: null,
      error: "Reservation failed: no reservation returned.",
    };
  }
  reservationId = bookingRow.reservation_id as string;
  if (
    typeof bookingRow.confirmation_code === "string" &&
    bookingRow.confirmation_code.trim().length > 0
  ) {
    persistedConfirmationCode = bookingRow.confirmation_code as string;
  }

  // Calculate totals
  const { data: rest } = await supabaseAdmin
    .from("restaurants")
    .select("tax_rate, currency, slug")
    .eq("id", restaurant_id)
    .single();

  const taxRate = rest?.tax_rate ?? DEFAULT_TAX_RATE_FALLBACK;
  const subtotal = items.reduce((s, i) => s + i.unit_price * i.quantity, 0);
  const taxAmount = n2(subtotal * taxRate);
  const total = n2(subtotal + taxAmount);

  // Create order only if there's a preorder
  const orderNotes = [notes, special_request]
    .filter(Boolean)
    .join(" | ") || null;

  let orderId: string | null = null;
  if (items.length > 0) {
    const { data: order, error: orderErr } = await supabaseAdmin
      .from("orders")
      .insert({
        restaurant_id,
        guest_id: guestId,
        reservation_id: reservationId,
        order_type: "dine_in",
        is_preorder: true,
        status: "pending",
        subtotal: n2(subtotal),
        tax_amount: taxAmount,
        total_amount: total,
        confirmation_code: persistedConfirmationCode,
        notes: orderNotes,
        source: "cenaiva",
      })
      .select("id")
      .single();

    if (orderErr) {
      return {
        success: false,
        confirmation_code: "",
        order_type,
        reservation_id: reservationId,
        order_id: null,
        guest_id: guestId ?? null,
        subtotal: n2(subtotal),
        tax: taxAmount,
        total,
        currency: rest?.currency ?? DEFAULT_CURRENCY,
        checkout_url: null,
        error: `Order creation failed: ${orderErr.message}`,
      };
    }
    orderId = order.id;

    if (items.length > 0) {
      const orderItems = items.map((item) => ({
        order_id: orderId,
        menu_item_id: item.menu_item_id,
        name: item.name,
        quantity: item.quantity,
        unit_price: item.unit_price,
        line_total: n2(item.unit_price * item.quantity),
        modifications: item.modifications ?? null,
        status: "pending",
      }));
      await supabaseAdmin.from("order_items").insert(orderItems);
    }
  }

  // Send SMS/email confirmation. Mirrors create-public-booking's notify
  // behavior so voice bookings (which call completeBooking via the
  // orchestrator) reach the user the same way as web/public bookings did.
  // Without this, voice bookings silently skipped notification because
  // create-public-booking's inline Twilio call was never reached.
  try {
    const { data: restaurantForNotify } = await supabaseAdmin
      .from("restaurants")
      .select("name, slug, timezone, phone")
      .eq("id", restaurant_id)
      .single();
    const restaurantName = restaurantForNotify?.name ?? "your restaurant";
    const restaurantSlug = restaurantForNotify?.slug ?? null;
    const restaurantPhone = typeof restaurantForNotify?.phone === "string" && restaurantForNotify.phone.trim()
      ? restaurantForNotify.phone.trim()
      : null;
    const tz = restaurantForNotify?.timezone || DEFAULT_TIMEZONE;
    const reservationDateLabel = formatReservationDate(new Date(date_time), tz);
    // Email is required for guest cancel/modify (2026-05-22 security hardening).
    // Include it in the URL so the diner can manage without re-entering it.
    // Logged-in callers ignore the param.
    const manageLink = restaurantSlug && persistedConfirmationCode
      ? `https://cenaiva.com/${restaurantSlug}?confirmation=${encodeURIComponent(persistedConfirmationCode)}${guestFields.email ? `&email=${encodeURIComponent(guestFields.email)}` : ""}`
      : null;
    const guestNameForBody = guestFields.full_name || "there";
    // Look up event/promotion details to enrich the confirmation message
    let eventLine = "";
    let promoLine = "";
    if (event_id) {
      const { data: ev } = await supabaseAdmin
        .from("events")
        .select("name, start_time")
        .eq("id", event_id)
        .maybeSingle();
      if (ev?.name) {
        eventLine = ` Event: ${ev.name}.`;
      }
    }
    if (promotion_id) {
      const { data: pr } = await supabaseAdmin
        .from("promotions")
        .select("title, promo_code")
        .eq("id", promotion_id)
        .maybeSingle();
      if (pr?.title) {
        const codePart = pr.promo_code ? ` (code ${pr.promo_code})` : "";
        promoLine = ` Promo: ${pr.title}${codePart}.`;
      }
    } else if (applied_promo_code) {
      promoLine = ` Promo code: ${applied_promo_code}.`;
    }
    const confirmationBody = buildConfirmationBody({
      guestName: guestNameForBody,
      restaurantName,
      partySize: party_size,
      reservationDateLabel,
      eventLine,
      promoLine,
      confirmationCode: persistedConfirmationCode,
      manageLink,
      restaurantPhone,
      preorderItems: items.length > 0
        ? items.map((item) => ({ name: item.name, quantity: item.quantity }))
        : null,
      depositPaidCents: null,
    });
    await sendReservationNotification({
      supabase: supabaseAdmin,
      guestId: guestId!,
      restaurantId: restaurant_id,
      reservationId: reservationId,
      type: "reservation_confirmation",
      email: guestFields.email || null,
      phone: guestFields.phone || null,
      subject: `Your reservation at ${restaurantName}`,
      body: confirmationBody,
    });
  } catch (notifyErr) {
    // Notification failure must NOT block the booking response. The
    // reservation is already persisted; we just log the failure.
    console.error("[completeBooking] SMS/email notify failed:", notifyErr);
  }

  // Owner notification (fire-and-forget). Covers every caller of
  // completeBooking — voice (cenaiva-orchestrate), AI chat (cenaiva-chat),
  // and any future programmatic booking path. Honors the owner's
  // notification_preferences_json.new_reservation_email toggle internally.
  void notifyOwnerNewReservation({
    supabase: supabaseAdmin,
    restaurant_id,
    reservation_id: reservationId,
    reserved_at: date_time,
    party_size,
    guest_full_name: guestFields.full_name || null,
    confirmation_code: persistedConfirmationCode,
  }).catch((err) => {
    console.error("[completeBooking] notifyOwnerNewReservation failed:", err);
  });

  return {
    success: true,
    confirmation_code: persistedConfirmationCode,
    order_type,
    reservation_id: reservationId,
    order_id: orderId,
    guest_id: guestId ?? null,
    subtotal: n2(subtotal),
    tax: taxAmount,
    total,
    currency: rest?.currency ?? DEFAULT_CURRENCY,
    checkout_url:
      orderId && rest?.slug ? `/${rest.slug}?order_id=${orderId}&step=checkout` : null,
  };
}

// Patch reservation + guest post-booking fields
export async function patchPostBooking(
  reservation_id: string,
  guest_id: string,
  fields: {
    special_request?: string;
    occasion?: string;
    seating_preference?: string;
    dietary_restrictions?: string[];
  },
) {
  const { special_request, occasion, seating_preference, dietary_restrictions } = fields;

  if (special_request !== undefined || occasion !== undefined) {
    await supabaseAdmin
      .from("reservations")
      .update({
        ...(special_request !== undefined ? { special_request } : {}),
        ...(occasion !== undefined ? { occasion } : {}),
      })
      .eq("id", reservation_id);
  }

  if (seating_preference !== undefined || dietary_restrictions !== undefined) {
    await supabaseAdmin
      .from("guests")
      .update({
        ...(seating_preference !== undefined ? { seating_preference } : {}),
        ...(dietary_restrictions !== undefined ? { dietary_restrictions } : {}),
      })
      .eq("id", guest_id);
  }
}
