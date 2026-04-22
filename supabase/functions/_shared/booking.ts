import { supabaseAdmin } from "./supabase.ts";

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

  // Create reservation
  let reservationId: string | null = null;
  const { data: reservation, error: resvErr } = await supabaseAdmin
    .from("reservations")
    .insert({
      restaurant_id,
      guest_id: guestId,
      shift_id,
      party_size,
      reserved_at: date_time,
      status: "confirmed",
      source: "cenaiva",
      confirmation_code: confirmationCode,
      special_request: special_request ?? null,
      occasion: occasion ?? null,
    })
    .select("id")
    .single();
  if (resvErr) {
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
      error: `Reservation failed: ${resvErr.message}`,
    };
  }
  reservationId = reservation.id;

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
