import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import OpenAI from "npm:openai@4";
import { corsHeaders } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";
import { jsonRes } from "../_shared/json-response.ts";
import { decodeJwtPayload } from "../_shared/jwt.ts";
import { getAvailability } from "../_shared/availability.ts";
import { completeBooking, patchPostBooking } from "../_shared/booking.ts";

const openai = new OpenAI({ apiKey: Deno.env.get("OPENAI_API_KEY")! });
const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";

// ── UI action types list (kept in sync with @cenaiva/assistant schema) ────────

const UI_ACTION_TYPES = [
  "open_assistant","close_assistant","show_map","update_map_center",
  "update_map_markers","highlight_restaurant","show_restaurant_cards",
  "open_restaurant_preview","set_filters","clear_filters","start_booking",
  "set_booking_field","load_availability","select_time_slot","confirm_booking",
  "show_confirmation","show_post_booking_questions","show_exit_x",
  "toast","navigate","fallback_to_manual",
  // Pre-order actions
  "offer_preorder","show_menu","add_menu_item","remove_menu_item","clear_cart",
  "set_tip_choice","set_tip","set_payment_split","navigate_to_checkout","show_payment_success",
];

// ── Tools ─────────────────────────────────────────────────────────────────────

const TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "search_restaurants",
      description:
        "Search dine-in restaurants. Call with no params to show all. Add cuisine_type/city/query when user specifies. Never pass 'near me' as query — use city from context.",
      parameters: {
        type: "object",
        properties: {
          cuisine_type: { type: "string", description: "e.g. Italian, Japanese" },
          city: { type: "string" },
          query: { type: "string", description: "Free-text name search" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_availability",
      description: "Get available time slots for a restaurant on a given date for a party size.",
      parameters: {
        type: "object",
        properties: {
          restaurant_id: { type: "string" },
          date: { type: "string", description: "YYYY-MM-DD" },
          party_size: { type: "number" },
        },
        required: ["restaurant_id","date","party_size"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "complete_booking",
      description: "Create a confirmed dine-in reservation. Call only after date_time, shift_id, and party_size are all known.",
      parameters: {
        type: "object",
        properties: {
          restaurant_id: { type: "string" },
          shift_id: { type: "string" },
          party_size: { type: "number" },
          date_time: { type: "string", description: "UTC ISO from check_availability slot" },
          special_request: { type: "string" },
          occasion: { type: "string" },
          seating_preference: { type: "string" },
        },
        required: ["restaurant_id","shift_id","party_size","date_time"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "patch_post_booking",
      description: "Update post-booking details (special_request, occasion, seating_preference) after confirmation.",
      parameters: {
        type: "object",
        properties: {
          reservation_id: { type: "string" },
          guest_id: { type: "string" },
          special_request: { type: "string" },
          occasion: { type: "string" },
          seating_preference: { type: "string" },
        },
        required: ["reservation_id","guest_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_menu",
      description: "Fetch pre-orderable menu items for a restaurant, grouped by category.",
      parameters: {
        type: "object",
        properties: {
          restaurant_id: { type: "string" },
        },
        required: ["restaurant_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_preorder_order",
      description: "Create a pending pre-order linked to the reservation. Returns order_id and subtotal.",
      parameters: {
        type: "object",
        properties: {
          restaurant_id: { type: "string" },
          reservation_id: { type: "string" },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                menu_item_id: { type: "string" },
                name: { type: "string" },
                quantity: { type: "number" },
                unit_price: { type: "number" },
              },
              required: ["menu_item_id","name","quantity","unit_price"],
              additionalProperties: false,
            },
          },
        },
        required: ["restaurant_id","reservation_id","items"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "charge_saved_card",
      description: "Charge the user's default saved card for a pre-order. Returns success + total charged.",
      parameters: {
        type: "object",
        properties: {
          order_id: { type: "string" },
          tip_percent: { type: "number", description: "0–100; use 0 if no tip" },
          tip_amount: { type: "number", description: "Dollar amount (alternative to tip_percent)" },
        },
        required: ["order_id"],
        additionalProperties: false,
      },
    },
  },
];

// ── Nominatim city lookup ─────────────────────────────────────────────────────

async function resolveCity(lat: number, lng: number): Promise<string> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=10`;
    const res = await fetch(url, { headers: { "User-Agent": "Seatly/1.0 (seatly.app)" } });
    if (!res.ok) return "";
    const data = await res.json() as { address?: Record<string, string> };
    const a = data.address ?? {};
    return a.city ?? a.town ?? a.municipality ?? a.village ?? a.suburb ?? "";
  } catch {
    return "";
  }
}

// ── System prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(opts: {
  firstName: string;
  userName: string;
  userCity: string;
  now: string;
  bookingState: Record<string, unknown>;
  currentScreen: string;
  hasSavedCard: boolean;
}) {
  return `You are Cenaiva, a voice-first dine-in table reservation assistant.
Today: ${opts.now}. User: ${opts.userName} (first name: ${opts.firstName}). City: ${opts.userCity || "unknown"}. Screen: ${opts.currentScreen}.
Has saved card on file: ${opts.hasSavedCard}.
Current booking state: ${JSON.stringify(opts.bookingState)}.

Cenaiva handles DINE-IN RESERVATIONS AND PRE-ORDER PAYMENT ONLY.
Never mention pickup, delivery, or takeout. If asked, say: "I only handle dine-in table bookings."

FLOW — follow exactly in this order:
1. The client already greeted the user. The first user message is a cuisine or preference signal — NOT a greeting. Treat it as step 1.
   MANDATORY: When booking_state.status is "idle" or missing, ALWAYS call search_restaurants first. NEVER emit spoken_text about reservations without first calling search_restaurants.
2. Call search_restaurants (even with no params if user is vague — return all), then emit update_map_markers + show_restaurant_cards. Ask which restaurant they'd like.
3. When user picks a restaurant, emit highlight_restaurant + start_booking.
4. Collect party_size and date via set_booking_field. Call check_availability. User picks slot → select_time_slot.
5. Call complete_booking → emit show_confirmation + show_exit_x.
6. Then emit offer_preorder and ask: "Want to pre-order from the menu?" (≤ 10 words).
   a. If no: emit show_post_booking_questions. DONE.
   b. If yes: call get_menu, emit show_menu. Track items via add_menu_item as user names them.
      When user says "done" / "that's it":
      i.  Call create_preorder_order with all cart items. Store order_id.
      ii. Emit set_tip_choice with choice="now" or "after" based on user preference.
          Ask: "Tip now or after your meal?" (wait for answer).
      iii. If "after": emit show_payment_success with amount_charged=0. Spoken: "You're set — pay at the table." DONE.
      iv. If "now": ask tip amount. Parse response: "twenty percent" → percent=20; "ten dollars" → amount=10.
          Emit set_tip with parsed values.
      v.  Ask: "Single card or split?" Emit set_payment_split with choice.
          - "split" → emit navigate_to_checkout with order_id and path="/r/{restaurant_slug}?order_id={order_id}&step=checkout". DONE.
          - "single" AND hasSavedCard=true → call charge_saved_card, emit show_payment_success. DONE.
          - "single" AND hasSavedCard=false → emit navigate_to_checkout. DONE.

RULES:
- spoken_text ≤ 20 words. No filler ("Sure!", "Of course!", "Great choice!"). Direct.
- One question per turn.
- NEVER say "no reservations available" unless you've called check_availability and confirmed it returned no slots. If search_restaurants returns results, show them.
- NEVER call check_availability unless restaurant_id, date, AND party_size are all known.
- If you have enough info, act (emit actions) instead of asking.
- Never ask post-booking questions (occasion, dietary) BEFORE show_confirmation.
- Parse tip freely from natural speech. When unsure, default to 20% and confirm.
- Always echo the conversation_id in every response.
- All UI actions must use types from this list: ${UI_ACTION_TYPES.join(", ")}.`;
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Auth
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const payload = decodeJwtPayload(token);
    if (!payload?.sub) return jsonRes({ error: "Unauthorized" }, 401);

    const { data: userProfile } = await supabaseAdmin
      .from("user_profiles")
      .select("id, full_name, email")
      .eq("auth_user_id", payload.sub as string)
      .single();
    if (!userProfile) return jsonRes({ error: "User profile not found" }, 401);

    const userProfileId: string = userProfile.id;
    const userName: string = userProfile.full_name ?? "there";
    const firstName = userName.split(" ")[0];

    // Parse body
    const body = await req.json() as {
      transcript?: string;
      screen?: string;
      booking_state?: Record<string, unknown>;
      map_state?: Record<string, unknown>;
      filters?: Record<string, unknown>;
      visible_restaurant_ids?: string[];
      selected_restaurant_id?: string | null;
      user_location?: { lat: number; lng: number } | null;
      conversation_id?: string;
      has_saved_card?: boolean;
      guest_id?: string | null;
      reservation_id?: string | null;
    };

    const {
      transcript = "",
      screen = "discover",
      booking_state = {},
      visible_restaurant_ids = [],
      selected_restaurant_id = null,
      user_location = null,
      conversation_id: incomingConvId,
      has_saved_card = false,
    } = body;

    // Resolve city
    const userCity = user_location
      ? await resolveCity(user_location.lat, user_location.lng)
      : "";

    // Conversation persistence
    let conversationId = incomingConvId;
    if (!conversationId) {
      const { data: conv } = await supabaseAdmin
        .from("chat_conversations")
        .insert({ user_profile_id: userProfileId, language: "en", title: "Voice booking" })
        .select("id")
        .single();
      conversationId = conv?.id ?? crypto.randomUUID();
    }

    // Load last 10 messages
    const { data: history } = await supabaseAdmin
      .from("chat_messages")
      .select("role, content, metadata")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(10);

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    for (const msg of (history ?? []).reverse()) {
      if (msg.role === "user") {
        messages.push({ role: "user", content: msg.content });
      } else if (msg.role === "assistant") {
        messages.push({ role: "assistant", content: msg.content });
      } else if (msg.role === "tool_call") {
        const meta = msg.metadata as Record<string, unknown>;
        messages.push({
          role: "assistant",
          content: null,
          tool_calls: [{
            id: meta.tool_use_id as string,
            type: "function",
            function: { name: meta.tool_name as string, arguments: JSON.stringify(meta.input) },
          }],
        });
      } else if (msg.role === "tool_result") {
        const meta = msg.metadata as Record<string, unknown>;
        messages.push({
          role: "tool",
          tool_call_id: meta.tool_use_id as string,
          content: msg.content,
        });
      }
    }

    const userContent = [
      transcript ? `User said: "${transcript}"` : "User opened the assistant.",
      selected_restaurant_id ? `Selected restaurant ID: ${selected_restaurant_id}` : "",
      visible_restaurant_ids.length
        ? `Visible restaurant IDs: ${visible_restaurant_ids.slice(0, 8).join(", ")}`
        : "",
    ].filter(Boolean).join("\n");

    messages.push({ role: "user", content: userContent });

    await supabaseAdmin.from("chat_messages").insert({
      conversation_id: conversationId,
      role: "user",
      content: userContent,
      metadata: { kind: "orchestrator" },
    });

    const systemPrompt = buildSystemPrompt({
      firstName,
      userName,
      userCity,
      now: new Date().toISOString(),
      bookingState: booking_state,
      currentScreen: screen,
      hasSavedCard: has_saved_card,
    });

    // ── Tool-use loop ─────────────────────────────────────────────────────────
    const MAX_ITER = 5;
    let iterations = 0;
    let lastReservationId: string | null = (booking_state.reservation_id as string) ?? null;
    let lastGuestId: string | null = null;

    while (iterations < MAX_ITER) {
      iterations++;

      // Force a tool call on the first turn when no restaurant has been selected yet
      // — prevents the model from skipping search_restaurants and hallucinating a response.
      const isFirstTurnNoRestaurant =
        iterations === 1 &&
        !selected_restaurant_id &&
        (!booking_state.status || booking_state.status === "idle");

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 600,
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        tools: TOOLS,
        tool_choice: isFirstTurnNoRestaurant ? "required" : "auto",
      });

      const choice = completion.choices[0];

      if (choice.finish_reason === "tool_calls" && choice.message.tool_calls?.length) {
        messages.push(choice.message as OpenAI.Chat.ChatCompletionMessageParam);

        for (const tc of choice.message.tool_calls) {
          const toolName = tc.function.name;
          const toolInput = JSON.parse(tc.function.arguments);
          let toolResult = "";

          // ── search_restaurants ────────────────────────────────────────────
          if (toolName === "search_restaurants") {
            let query = supabaseAdmin
              .from("restaurants")
              .select("id, name, cuisine_type, city, description, address, lat, lng, slug")
              .eq("is_active", true)
              .limit(8);
            if (toolInput.cuisine_type) query = query.ilike("cuisine_type", `%${toolInput.cuisine_type}%`);
            if (toolInput.city) query = query.ilike("city", `%${toolInput.city}%`);
            if (toolInput.query) {
              const words = toolInput.query.trim().split(/\s+/).filter((w: string) => w.length > 1);
              if (words.length) {
                const conditions = words
                  .map((w: string) => `name.ilike.%${w}%,cuisine_type.ilike.%${w}%,city.ilike.%${w}%`)
                  .join(",");
                query = query.or(conditions);
              }
            }
            const { data, error } = await query;
            toolResult = error ? JSON.stringify({ error: error.message }) : JSON.stringify(data ?? []);
          }

          // ── check_availability ────────────────────────────────────────────
          else if (toolName === "check_availability") {
            const result = await getAvailability(
              toolInput.restaurant_id,
              toolInput.date,
              toolInput.party_size,
            );
            toolResult = JSON.stringify(result);
          }

          // ── complete_booking ──────────────────────────────────────────────
          else if (toolName === "complete_booking") {
            const result = await completeBooking({
              user_profile_id: userProfileId,
              restaurant_id: toolInput.restaurant_id,
              order_type: "dine_in",
              date_time: toolInput.date_time,
              shift_id: toolInput.shift_id,
              party_size: toolInput.party_size,
              special_request: toolInput.special_request,
              occasion: toolInput.occasion,
              seating_preference: toolInput.seating_preference,
            });
            if (result.reservation_id) lastReservationId = result.reservation_id;
            if (result.guest_id) lastGuestId = result.guest_id;
            toolResult = JSON.stringify(result);
          }

          // ── patch_post_booking ────────────────────────────────────────────
          else if (toolName === "patch_post_booking") {
            await patchPostBooking(
              toolInput.reservation_id,
              toolInput.guest_id,
              {
                special_request: toolInput.special_request,
                occasion: toolInput.occasion,
                seating_preference: toolInput.seating_preference,
              },
            );
            toolResult = JSON.stringify({ success: true });
          }

          // ── get_menu ──────────────────────────────────────────────────────
          else if (toolName === "get_menu") {
            const { data: menuItems, error } = await supabaseAdmin
              .from("menu_items")
              .select("id, name, description, price, category, category_id, dietary_flags, allergens, is_preorderable, is_available")
              .eq("restaurant_id", toolInput.restaurant_id)
              .eq("is_active", true)
              .eq("is_preorderable", true)
              .eq("is_available", true)
              .order("sort_order");

            if (error) {
              toolResult = JSON.stringify({ error: error.message });
            } else {
              // Compact output — omit null fields to save tokens
              const compactItems = (menuItems ?? []).map((i: Record<string, unknown>) => ({
                id: i.id,
                name: i.name,
                price: i.price,
                category: i.category,
                ...(i.dietary_flags ? { dietary_flags: i.dietary_flags } : {}),
              }));
              toolResult = JSON.stringify({ items: compactItems });
            }
          }

          // ── create_preorder_order ─────────────────────────────────────────
          else if (toolName === "create_preorder_order") {
            const { restaurant_id, reservation_id, items } = toolInput;
            if (!items?.length) {
              toolResult = JSON.stringify({ error: "No items provided." });
            } else {
              // Ensure guest row exists (upsert based on user_profile_id + restaurant)
              const { data: existingGuest } = await supabaseAdmin
                .from("guests")
                .select("id")
                .eq("user_profile_id", userProfileId)
                .eq("restaurant_id", restaurant_id)
                .maybeSingle();

              let guestId: string;
              if (existingGuest) {
                guestId = existingGuest.id;
              } else {
                const { data: newGuest, error: guestErr } = await supabaseAdmin
                  .from("guests")
                  .insert({ user_profile_id: userProfileId, restaurant_id, full_name: userName })
                  .select("id")
                  .single();
                if (guestErr || !newGuest) {
                  toolResult = JSON.stringify({ error: `Guest creation failed: ${guestErr?.message}` });
                  messages.push({ role: "tool", tool_call_id: tc.id, content: toolResult });
                  continue;
                }
                guestId = newGuest.id;
              }
              lastGuestId = guestId;

              // Fetch restaurant for tax rate + slug
              const { data: rest } = await supabaseAdmin
                .from("restaurants")
                .select("tax_rate, currency, slug")
                .eq("id", restaurant_id)
                .single();
              const taxRate = rest?.tax_rate ?? 0.13;
              const subtotal = items.reduce((sum: number, i: { unit_price: number; quantity: number }) => sum + i.unit_price * i.quantity, 0);
              const taxAmount = Math.round(subtotal * taxRate * 100) / 100;
              const total = Math.round((subtotal + taxAmount) * 100) / 100;

              const confirmationCode = `PRE-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

              const { data: order, error: orderErr } = await supabaseAdmin
                .from("orders")
                .insert({
                  restaurant_id,
                  guest_id: guestId,
                  reservation_id: reservation_id || lastReservationId,
                  order_type: "dine_in",
                  is_preorder: true,
                  status: "pending",
                  subtotal: Math.round(subtotal * 100) / 100,
                  tax_amount: taxAmount,
                  total_amount: total,
                  confirmation_code: confirmationCode,
                  source: "cenaiva",
                })
                .select("id")
                .single();

              if (orderErr || !order) {
                toolResult = JSON.stringify({ error: `Order creation failed: ${orderErr?.message}` });
              } else {
                const orderItems = items.map((item: { menu_item_id: string; name: string; quantity: number; unit_price: number }) => ({
                  order_id: order.id,
                  menu_item_id: item.menu_item_id,
                  name: item.name,
                  quantity: item.quantity,
                  unit_price: item.unit_price,
                  line_total: Math.round(item.unit_price * item.quantity * 100) / 100,
                  status: "pending",
                }));
                await supabaseAdmin.from("order_items").insert(orderItems);

                const checkoutPath = rest?.slug
                  ? `/r/${rest.slug}?order_id=${order.id}&step=checkout`
                  : null;

                toolResult = JSON.stringify({
                  success: true,
                  order_id: order.id,
                  subtotal: Math.round(subtotal * 100) / 100,
                  tax: taxAmount,
                  total,
                  currency: rest?.currency || "CAD",
                  checkout_path: checkoutPath,
                });
              }
            }
          }

          // ── charge_saved_card ─────────────────────────────────────────────
          else if (toolName === "charge_saved_card") {
            const { order_id, tip_percent, tip_amount: tipAmountInput } = toolInput;
            if (!order_id) {
              toolResult = JSON.stringify({ success: false, error: "order_id required." });
            } else {
              const { data: order } = await supabaseAdmin
                .from("orders")
                .select("id, restaurant_id, subtotal, tax_amount, discount_amount, paid_at, guest_id")
                .eq("id", order_id)
                .single();

              if (!order) {
                toolResult = JSON.stringify({ success: false, error: "Order not found." });
              } else if (order.paid_at) {
                toolResult = JSON.stringify({ success: false, error: "Order already paid." });
              } else {
                const { data: savedCard } = await supabaseAdmin
                  .from("saved_cards")
                  .select("id, brand, last4, stripe_payment_method_id")
                  .eq("user_profile_id", userProfileId)
                  .order("is_default", { ascending: false })
                  .limit(1)
                  .maybeSingle();

                if (!savedCard) {
                  toolResult = JSON.stringify({ success: false, error: "No saved card found." });
                } else {
                  const subtotal = Number(order.subtotal || 0);
                  const tax = Number(order.tax_amount || 0);
                  const discount = Number(order.discount_amount || 0);
                  const tipAmt = tip_percent != null
                    ? Math.round(subtotal * (Number(tip_percent) / 100) * 100) / 100
                    : Math.round(Number(tipAmountInput || 0) * 100) / 100;
                  const total = Math.round((subtotal + tax - discount + tipAmt) * 100) / 100;
                  const paidAt = new Date().toISOString();

                  if (stripeSecretKey) {
                    const { default: Stripe } = await import("npm:stripe@17");
                    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2024-11-20.acacia" });

                    const { data: profile } = await supabaseAdmin
                      .from("user_profiles")
                      .select("stripe_customer_id")
                      .eq("id", userProfileId)
                      .single();

                    if (!profile?.stripe_customer_id || !savedCard.stripe_payment_method_id) {
                      toolResult = JSON.stringify({ success: false, error: "Stripe not configured. Use checkout page." });
                    } else {
                      const { data: rest } = await supabaseAdmin
                        .from("restaurants")
                        .select("currency")
                        .eq("id", order.restaurant_id)
                        .single();
                      const currency = (rest?.currency || "CAD").toLowerCase();

                      try {
                        const paymentIntent = await stripe.paymentIntents.create({
                          amount: Math.round(total * 100),
                          currency,
                          customer: profile.stripe_customer_id,
                          payment_method: savedCard.stripe_payment_method_id,
                          off_session: true,
                          confirm: true,
                          metadata: { order_id, user_profile_id: userProfileId },
                        });

                        await supabaseAdmin.from("orders").update({
                          tip_amount: tipAmt, total_amount: total,
                          payment_method: "stripe", status: "paid",
                          paid_at: paidAt, billed_at: paidAt,
                          stripe_payment_intent_id: paymentIntent.id,
                        }).eq("id", order_id);

                        await supabaseAdmin.from("payments").insert({
                          order_id, restaurant_id: order.restaurant_id,
                          user_profile_id: userProfileId,
                          stripe_payment_intent_id: paymentIntent.id,
                          amount: total, currency, status: "succeeded", payment_type: "stripe",
                        });

                        toolResult = JSON.stringify({
                          success: true, total_charged: total, tip_amount: tipAmt,
                          currency: rest?.currency || "CAD", paid_at: paidAt,
                          card_brand: savedCard.brand, card_last4: savedCard.last4, mode: "live",
                        });
                      } catch (stripeErr: unknown) {
                        const msg = (stripeErr as { code?: string; message?: string });
                        toolResult = JSON.stringify({
                          success: false,
                          error: msg?.code === "authentication_required"
                            ? "Card requires verification. Use checkout page."
                            : (msg?.message || "Card declined."),
                        });
                      }
                    }
                  } else {
                    // Test mode
                    const testId = `test_pi_${Math.random().toString(36).slice(2, 12)}`;
                    await supabaseAdmin.from("orders").update({
                      tip_amount: tipAmt, total_amount: total,
                      payment_method: "card_test", status: "paid",
                      paid_at: paidAt, billed_at: paidAt,
                      stripe_payment_intent_id: testId,
                    }).eq("id", order_id);

                    await supabaseAdmin.from("payments").insert({
                      order_id, restaurant_id: order.restaurant_id,
                      user_profile_id: userProfileId,
                      stripe_payment_intent_id: testId,
                      amount: total, currency: "cad", status: "succeeded", payment_type: "test",
                    });

                    toolResult = JSON.stringify({
                      success: true, total_charged: total, tip_amount: tipAmt,
                      currency: "CAD", paid_at: paidAt,
                      card_brand: savedCard.brand, card_last4: savedCard.last4, mode: "test",
                    });
                  }
                }
              }
            }
          }

          // Persist tool call + result
          await supabaseAdmin.from("chat_messages").insert([
            {
              conversation_id: conversationId,
              role: "tool_call",
              content: JSON.stringify(toolInput),
              metadata: { kind: "orchestrator", tool_use_id: tc.id, tool_name: toolName, input: toolInput },
            },
            {
              conversation_id: conversationId,
              role: "tool_result",
              content: toolResult,
              metadata: { kind: "orchestrator", tool_use_id: tc.id },
            },
          ]);

          messages.push({ role: "tool", tool_call_id: tc.id, content: toolResult });
        }
      } else {
        break;
      }
    }

    // ── Final structured JSON turn ────────────────────────────────────────────
    const jsonCompletion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 500,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages,
        {
          role: "user",
          content: `Now respond with ONLY a valid JSON object. Required fields: conversation_id (must be "${conversationId}"), spoken_text (≤20 words), intent, step, ui_actions (array), booking (object or null), map (object or null), filters (object or null), next_expected_input. Use only ui_action types from the approved list.`,
        },
      ],
      response_format: { type: "json_object" },
    });

    const rawJson = jsonCompletion.choices[0].message.content ?? "{}";
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      parsed = {
        conversation_id: conversationId,
        spoken_text: "Something went wrong. Please try again.",
        intent: "fallback_handoff",
        step: "greeting",
        ui_actions: [{ type: "fallback_to_manual" }],
        booking: null,
        map: null,
        filters: null,
        next_expected_input: "none",
      };
    }

    parsed.conversation_id = conversationId;

    await supabaseAdmin.from("chat_messages").insert({
      conversation_id: conversationId,
      role: "assistant",
      content: (parsed.spoken_text as string) ?? "",
      metadata: { kind: "orchestrator", full_response: parsed },
    });

    return jsonRes(parsed);
  } catch (err) {
    console.error("cenaiva-orchestrate error:", err);
    return jsonRes({ error: String(err) }, 500);
  }
});
