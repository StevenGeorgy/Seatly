import { supabaseAdmin } from "./supabase.ts";
import {
  closureUnavailableMessage,
  findClosedSpecialDayForDate,
  localDateForDateTime,
} from "./closures.ts";

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

function normalizeEmail(email?: string | null): string | null {
  return typeof email === "string" && email.trim() ? email.trim().toLowerCase() : null;
}

async function getRestaurantTurnTimeMinutes(restaurantId: string, shiftId?: string | null): Promise<number> {
  const { data } = await supabaseAdmin.rpc("restaurant_turn_time_minutes", {
    p_restaurant_id: restaurantId,
    p_shift_id: shiftId ?? null,
  });
  return typeof data === "number" && Number.isFinite(data) ? data : 90;
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
    notes,
  } = params;

  // Dine-in validation (dine_in is the only supported type)
  if (!date_time || !shift_id || !party_size) {
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
      currency: "CAD",
      checkout_url: null,
      error: "date_time, shift_id, and party_size are required.",
    };
  }

  // Load user profile for fallback guest fields
  const { data: userProfile } = await supabaseAdmin
    .from("user_profiles")
    .select("full_name, email, phone, allergies, dietary_restrictions, seating_preference, noise_preference")
    .eq("id", user_profile_id)
    .single();

  const resolvedEmail = normalizeEmail(guest_email ?? userProfile?.email ?? null);
  const resolvedPhone = guest_phone ?? userProfile?.phone ?? "";
  const reservedAt = new Date(date_time);
  if (Number.isNaN(reservedAt.getTime())) {
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
      currency: "CAD",
      checkout_url: null,
      error: "date_time must be a valid ISO timestamp.",
    };
  }

  const { data: restaurantCalendar } = await supabaseAdmin
    .from("restaurants")
    .select("timezone, hours_json")
    .eq("id", restaurant_id)
    .maybeSingle();
  const localBookingDate = localDateForDateTime(reservedAt, restaurantCalendar?.timezone || "UTC");
  const closure = localBookingDate
    ? findClosedSpecialDayForDate(restaurantCalendar?.hours_json, localBookingDate)
    : null;
  if (closure) {
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
      currency: "CAD",
      checkout_url: null,
      error: closureUnavailableMessage(closure),
    };
  }

  const { data: canonicalGuestId, error: canonicalGuestErr } = await supabaseAdmin.rpc("canonical_guest_id", {
    p_restaurant_id: restaurant_id,
    p_user_profile_id: user_profile_id,
    p_email: resolvedEmail,
    p_phone: resolvedPhone,
  });
  if (canonicalGuestErr) {
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
      currency: "CAD",
      checkout_url: null,
      error: `Guest lookup failed: ${canonicalGuestErr.message}`,
    };
  }

  const guestFields = {
    full_name: guest_name ?? userProfile?.full_name ?? "Guest",
    email: resolvedEmail ?? "",
    phone: resolvedPhone,
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

  let guestId = typeof canonicalGuestId === "string" ? canonicalGuestId : undefined;
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
        currency: "CAD",
        checkout_url: null,
        error: `Guest creation failed: ${guestErr.message}`,
      };
    }
    guestId = newGuest.id;
  } else {
    await supabaseAdmin.from("guests").update(guestFields).eq("id", guestId);
  }

  const confirmationCode = `SEAT-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const turnTimeMinutes = await getRestaurantTurnTimeMinutes(restaurant_id, shift_id);

  // Atomic booking via book_reservation RPC. Status='confirmed' for AI-driven
  // bookings (the diner has already agreed in chat). The advisory lock + the
  // exclusion constraint on reservation_tables together guarantee no two
  // overlapping bookings can be written for the same table.
  const { data: bookingRows, error: bookingError } = await supabaseAdmin.rpc("book_reservation", {
    p_restaurant_id: restaurant_id,
    p_shift_id: shift_id,
    p_reserved_at: date_time,
    p_party_size: party_size,
    p_turn_minutes: turnTimeMinutes,
    p_guest_id: guestId,
    p_user_profile_id: user_profile_id,
    p_confirmation_code: confirmationCode,
    p_source: "cenaiva",
    p_special_request: special_request ?? null,
    p_occasion: occasion ?? null,
    p_status: "confirmed",
  });
  if (bookingError) {
    const code = (bookingError as { code?: string }).code;
    let errorMessage = `Reservation failed: ${bookingError.message}`;
    if (code === "P0001" || code === "23P01") {
      errorMessage = "That time was just taken. Please pick another slot.";
    } else if (code === "P0002") {
      errorMessage = "That time no longer has enough cover capacity.";
    }
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
      currency: "CAD",
      checkout_url: null,
      error: errorMessage,
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
      currency: "CAD",
      checkout_url: null,
      error: "Reservation failed: no reservation returned.",
    };
  }
  const reservationId: string = bookingRow.reservation_id as string;

  // Calculate totals
  const { data: rest } = await supabaseAdmin
    .from("restaurants")
    .select("tax_rate, currency, slug")
    .eq("id", restaurant_id)
    .single();

  const taxRate = rest?.tax_rate ?? 0.13;
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
        confirmation_code: confirmationCode,
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
        currency: rest?.currency ?? "CAD",
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

  return {
    success: true,
    confirmation_code: confirmationCode,
    order_type,
    reservation_id: reservationId,
    order_id: orderId,
    guest_id: guestId ?? null,
    subtotal: n2(subtotal),
    tax: taxAmount,
    total,
    currency: rest?.currency ?? "CAD",
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
