import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@0.32.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Supabase admin client (bypasses RLS) ──
const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

// ── JWT payload decoder ──
// The gateway (verify_jwt: true) already verified the JWT signature, so we
// only need to decode the payload to extract the user's auth ID (sub claim).
// This avoids supabase-js auth.getUser() which fails on ES256-signed tokens.
function decodeJwtPayload(token: string): Record<string, any> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1];
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const decoded = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

// ── Claude tools definition ──
const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_restaurants",
    description:
      "Search for restaurants by name, cuisine type, or city. Returns up to 5 matches.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Free-text search term" },
        cuisine_type: { type: "string", description: "e.g. Italian, Japanese, Lebanese" },
      },
    },
  },
  {
    name: "get_restaurant_info",
    description: "Get detailed information about a specific restaurant.",
    input_schema: {
      type: "object" as const,
      properties: {
        restaurant_id: { type: "string" },
      },
      required: ["restaurant_id"],
    },
  },
  {
    name: "browse_menu",
    description:
      "Browse menu items for a restaurant, optionally filtered by category or dietary needs.",
    input_schema: {
      type: "object" as const,
      properties: {
        restaurant_id: { type: "string" },
        category: { type: "string", description: "Menu category name to filter by" },
        dietary_filter: {
          type: "string",
          description: "e.g. vegetarian, gluten-free, nut-free",
        },
        max_price: { type: "number" },
      },
      required: ["restaurant_id"],
    },
  },
  {
    name: "check_availability",
    description:
      "Check available reservation time slots for a restaurant on a specific date.",
    input_schema: {
      type: "object" as const,
      properties: {
        restaurant_id: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD" },
        party_size: { type: "number", minimum: 1 },
      },
      required: ["restaurant_id", "date", "party_size"],
    },
  },
  {
    name: "create_reservation",
    description:
      "Book a reservation at a restaurant. ALWAYS confirm the details with the user before calling this tool.",
    input_schema: {
      type: "object" as const,
      properties: {
        restaurant_id: { type: "string" },
        date_time: { type: "string", description: "ISO 8601 datetime for the reservation" },
        party_size: { type: "number" },
        shift_id: { type: "string" },
        special_request: { type: "string" },
        occasion: { type: "string" },
      },
      required: ["restaurant_id", "date_time", "party_size", "shift_id"],
    },
  },
  {
    name: "place_order",
    description:
      "Place a pickup or delivery order. ALWAYS confirm items and total with the user before calling this tool.",
    input_schema: {
      type: "object" as const,
      properties: {
        restaurant_id: { type: "string" },
        order_type: {
          type: "string",
          enum: ["takeout", "delivery"],
          description: "Use 'takeout' for pickup orders",
        },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              menu_item_id: { type: "string" },
              name: { type: "string" },
              quantity: { type: "number" },
              unit_price: { type: "number" },
              modifications: { type: "string" },
            },
            required: ["menu_item_id", "name", "quantity", "unit_price"],
          },
        },
      },
      required: ["restaurant_id", "order_type", "items"],
    },
  },
  {
    name: "get_user_reservations",
    description: "Get the current user's upcoming reservations.",
    input_schema: {
      type: "object" as const,
      properties: {
        status: {
          type: "string",
          enum: ["pending", "confirmed", "all"],
          description: "Filter by reservation status",
        },
      },
    },
  },
];

// ── Tool execution ──
async function executeTool(
  toolName: string,
  input: Record<string, any>,
  userProfileId: string,
): Promise<string> {
  switch (toolName) {
    case "search_restaurants": {
      let query = supabaseAdmin
        .from("restaurants")
        .select("id, name, cuisine_type, city, description, address")
        .eq("is_active", true)
        .limit(5);
      if (input.cuisine_type) {
        query = query.ilike("cuisine_type", `%${input.cuisine_type}%`);
      }
      if (input.query) {
        query = query.or(
          `name.ilike.%${input.query}%,cuisine_type.ilike.%${input.query}%,city.ilike.%${input.query}%`,
        );
      }
      const { data, error } = await query;
      if (error) return JSON.stringify({ error: error.message });
      if (!data?.length) return JSON.stringify({ message: "No restaurants found." });
      return JSON.stringify(data);
    }

    case "get_restaurant_info": {
      const { data, error } = await supabaseAdmin
        .from("restaurants")
        .select(
          "id, name, cuisine_type, city, address, phone, description, currency, tax_rate, timezone",
        )
        .eq("id", input.restaurant_id)
        .single();
      if (error) return JSON.stringify({ error: error.message });
      return JSON.stringify(data);
    }

    case "browse_menu": {
      // Fetch categories first
      const { data: categories } = await supabaseAdmin
        .from("menu_categories")
        .select("id, name")
        .eq("restaurant_id", input.restaurant_id)
        .eq("is_active", true)
        .order("sort_order");

      let itemQuery = supabaseAdmin
        .from("menu_items")
        .select(
          "id, name, description, price, allergens, dietary_flags, is_available, category_id",
        )
        .eq("restaurant_id", input.restaurant_id)
        .eq("is_active", true)
        .eq("is_available", true)
        .order("sort_order");

      if (input.max_price) {
        itemQuery = itemQuery.lte("price", input.max_price);
      }

      const { data: items, error } = await itemQuery;
      if (error) return JSON.stringify({ error: error.message });

      // Filter by category name if provided
      let filtered = items || [];
      if (input.category && categories) {
        const cat = categories.find(
          (c: any) => c.name.toLowerCase() === input.category.toLowerCase(),
        );
        if (cat) {
          filtered = filtered.filter((i: any) => i.category_id === cat.id);
        }
      }

      // Filter by dietary needs
      if (input.dietary_filter) {
        const filter = input.dietary_filter.toLowerCase();
        filtered = filtered.filter((i: any) => {
          const flags = (i.dietary_flags || []).map((f: string) => f.toLowerCase());
          return flags.includes(filter);
        });
      }

      return JSON.stringify({
        categories: (categories || []).map((c: any) => c.name),
        items: filtered.slice(0, 20).map((i: any) => ({
          id: i.id,
          name: i.name,
          description: i.description,
          price: i.price,
          allergens: i.allergens,
          dietary_flags: i.dietary_flags,
        })),
      });
    }

    case "check_availability": {
      const { restaurant_id, date, party_size } = input;
      const dateObj = new Date(date);
      const dayOfWeek = dateObj.getDay() === 0 ? 7 : dateObj.getDay();
      const dateOnly = date.slice(0, 10);

      const { data: shifts } = await supabaseAdmin
        .from("shifts")
        .select(
          "id, name, start_time, end_time, slot_duration_minutes, turn_time_minutes, min_party_size, max_party_size, max_covers",
        )
        .eq("restaurant_id", restaurant_id)
        .eq("is_active", true)
        .contains("days_of_week", [dayOfWeek]);

      if (!shifts?.length)
        return JSON.stringify({ slots: [], message: "No shifts available on this date." });

      const { data: reservations } = await supabaseAdmin
        .from("reservations")
        .select("shift_id, reserved_at, party_size")
        .eq("restaurant_id", restaurant_id)
        .in("status", ["pending", "confirmed", "seated"])
        .gte("reserved_at", `${dateOnly}T00:00:00`)
        .lte("reserved_at", `${dateOnly}T23:59:59`);

      const slots: { shift_id: string; shift_name: string; time: string }[] = [];
      for (const shift of shifts) {
        if (
          party_size < (shift.min_party_size || 1) ||
          party_size > (shift.max_party_size || 20)
        )
          continue;

        const [sH, sM] = (shift.start_time || "17:00").split(":").map(Number);
        const [eH, eM] = (shift.end_time || "23:00").split(":").map(Number);
        const slotMins = shift.slot_duration_minutes || 30;
        const turnMins = shift.turn_time_minutes || 90;
        const maxCovers = shift.max_covers || 100;

        let slotMin = sH * 60 + sM;
        const endMin = eH * 60 + eM;

        while (slotMin + slotMins <= endMin) {
          const slotStart = new Date(dateObj);
          slotStart.setHours(Math.floor(slotMin / 60), slotMin % 60, 0, 0);
          const slotEnd = new Date(slotStart.getTime() + turnMins * 60 * 1000);

          const shiftResvs = (reservations || []).filter(
            (r: any) => r.shift_id === shift.id,
          );
          let totalCovers = party_size;
          let available = true;
          for (const r of shiftResvs) {
            const resvStart = new Date(r.reserved_at);
            const resvEnd = new Date(resvStart.getTime() + turnMins * 60 * 1000);
            if (slotStart < resvEnd && slotEnd > resvStart) {
              totalCovers += r.party_size || 0;
              if (totalCovers > maxCovers) {
                available = false;
                break;
              }
            }
          }
          if (available) {
            slots.push({
              shift_id: shift.id,
              shift_name: shift.name || "Shift",
              time: slotStart.toISOString().slice(0, 16).replace("T", " "),
            });
          }
          slotMin += slotMins;
        }
      }
      return JSON.stringify({ slots: slots.slice(0, 15) });
    }

    case "create_reservation": {
      const { restaurant_id, date_time, party_size, shift_id, special_request, occasion } =
        input;

      // Find or create guest record for this user at this restaurant
      const { data: existingGuest } = await supabaseAdmin
        .from("guests")
        .select("id")
        .eq("restaurant_id", restaurant_id)
        .eq("user_profile_id", userProfileId)
        .maybeSingle();

      let guestId = existingGuest?.id;
      if (!guestId) {
        const { data: profile } = await supabaseAdmin
          .from("user_profiles")
          .select("full_name, email, phone")
          .eq("id", userProfileId)
          .single();

        const { data: newGuest, error: guestErr } = await supabaseAdmin
          .from("guests")
          .insert({
            restaurant_id,
            user_profile_id: userProfileId,
            full_name: profile?.full_name || "Guest",
            email: profile?.email || "",
            phone: profile?.phone || "",
          })
          .select("id")
          .single();
        if (guestErr) return JSON.stringify({ error: `Guest creation failed: ${guestErr.message}` });
        guestId = newGuest.id;
      }

      const confirmationCode = `SEAT-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
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
          special_request: special_request || null,
          occasion: occasion || null,
        })
        .select("id, reserved_at, party_size, confirmation_code")
        .single();

      if (resvErr)
        return JSON.stringify({ error: `Reservation failed: ${resvErr.message}` });

      // Fire n8n webhook if configured
      fireWebhook("reservation_created", { reservation, restaurant_id });

      return JSON.stringify({
        success: true,
        confirmation_code: confirmationCode,
        reservation,
      });
    }

    case "place_order": {
      const { restaurant_id, order_type, items } = input;

      // Find or create guest
      const { data: existingGuest } = await supabaseAdmin
        .from("guests")
        .select("id")
        .eq("restaurant_id", restaurant_id)
        .eq("user_profile_id", userProfileId)
        .maybeSingle();

      let guestId = existingGuest?.id;
      if (!guestId) {
        const { data: profile } = await supabaseAdmin
          .from("user_profiles")
          .select("full_name, email, phone")
          .eq("id", userProfileId)
          .single();

        const { data: newGuest, error: guestErr } = await supabaseAdmin
          .from("guests")
          .insert({
            restaurant_id,
            user_profile_id: userProfileId,
            full_name: profile?.full_name || "Guest",
            email: profile?.email || "",
            phone: profile?.phone || "",
          })
          .select("id")
          .single();
        if (guestErr) return JSON.stringify({ error: `Guest creation failed: ${guestErr.message}` });
        guestId = newGuest.id;
      }

      // Get restaurant tax rate
      const { data: rest } = await supabaseAdmin
        .from("restaurants")
        .select("tax_rate, currency")
        .eq("id", restaurant_id)
        .single();
      const taxRate = rest?.tax_rate ?? 0.13;

      const subtotal = items.reduce(
        (sum: number, i: any) => sum + i.unit_price * i.quantity,
        0,
      );
      const taxAmount = Math.round(subtotal * taxRate * 100) / 100;
      const total = Math.round((subtotal + taxAmount) * 100) / 100;
      const confirmationCode = `SEAT-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

      const { data: order, error: orderErr } = await supabaseAdmin
        .from("orders")
        .insert({
          restaurant_id,
          guest_id: guestId,
          order_type,
          status: "pending",
          subtotal: Math.round(subtotal * 100) / 100,
          tax_amount: taxAmount,
          total_amount: total,
          confirmation_code: confirmationCode,
        })
        .select("id")
        .single();

      if (orderErr)
        return JSON.stringify({ error: `Order creation failed: ${orderErr.message}` });

      const orderItems = items.map((item: any) => ({
        order_id: order.id,
        menu_item_id: item.menu_item_id,
        name: item.name,
        quantity: item.quantity,
        unit_price: item.unit_price,
        line_total: Math.round(item.unit_price * item.quantity * 100) / 100,
        status: "pending",
      }));
      const { error: itemsErr } = await supabaseAdmin
        .from("order_items")
        .insert(orderItems);

      if (itemsErr)
        return JSON.stringify({ error: `Order items failed: ${itemsErr.message}` });

      fireWebhook("order_placed", {
        order_id: order.id,
        restaurant_id,
        order_type,
        total,
        confirmation_code: confirmationCode,
      });

      return JSON.stringify({
        success: true,
        order_id: order.id,
        confirmation_code: confirmationCode,
        subtotal: Math.round(subtotal * 100) / 100,
        tax: taxAmount,
        total,
        currency: rest?.currency || "CAD",
      });
    }

    case "get_user_reservations": {
      // Find all guest records for this user
      const { data: guests } = await supabaseAdmin
        .from("guests")
        .select("id, restaurant_id, restaurants(name)")
        .eq("user_profile_id", userProfileId);

      if (!guests?.length)
        return JSON.stringify({ reservations: [], message: "No reservations found." });

      const guestIds = guests.map((g: any) => g.id);
      let query = supabaseAdmin
        .from("reservations")
        .select("id, reserved_at, party_size, status, confirmation_code, guest_id")
        .in("guest_id", guestIds)
        .gte("reserved_at", new Date().toISOString())
        .order("reserved_at", { ascending: true })
        .limit(10);

      if (input.status && input.status !== "all") {
        query = query.eq("status", input.status);
      }

      const { data: reservations, error } = await query;
      if (error) return JSON.stringify({ error: error.message });

      const guestMap = new Map(guests.map((g: any) => [g.id, g]));
      const result = (reservations || []).map((r: any) => {
        const guest = guestMap.get(r.guest_id);
        return {
          ...r,
          restaurant_name: (guest?.restaurants as any)?.name || "Unknown",
        };
      });

      return JSON.stringify({ reservations: result });
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
}

// ── n8n webhook (fire-and-forget) ──
function fireWebhook(event: string, data: Record<string, any>) {
  const url = Deno.env.get("N8N_WEBHOOK_URL");
  if (!url) return;
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, timestamp: new Date().toISOString(), data }),
  }).catch(() => {});
}

// ── System prompt builder ──
function buildSystemPrompt(
  profile: { full_name: string; allergies?: string[]; dietary_restrictions?: string[] },
  language: string,
  restaurantContext?: { id: string; name: string; cuisine_type: string } | null,
): string {
  const now = new Date();
  const lang = language === "fr" ? "French" : "English";

  return `You are Cenaiva, the AI assistant for Seatly — a restaurant discovery and management platform. You help customers find restaurants, browse menus, check availability, make reservations, and place orders.

Personality:
- Warm, knowledgeable, concise
- You speak like a knowledgeable friend who loves food
- Keep responses under 3 sentences unless the user asks for detail
- When listing items (menu, restaurants, time slots), use clean formatting

Current context:
- Date/Time: ${now.toISOString()}
- Language: ${lang} (respond in ${lang})

User profile:
- Name: ${profile.full_name || "Guest"}
${profile.allergies?.length ? `- Allergies: ${profile.allergies.join(", ")}` : ""}
${profile.dietary_restrictions?.length ? `- Dietary restrictions: ${profile.dietary_restrictions.join(", ")}` : ""}

${
  restaurantContext
    ? `The user is currently viewing: ${restaurantContext.name} (${restaurantContext.cuisine_type})
Restaurant ID: ${restaurantContext.id}`
    : ""
}

Rules:
1. ALWAYS check availability before creating a reservation.
2. ALWAYS confirm details with the user before creating a reservation or placing an order — list what you will book/order and ask "Shall I go ahead?"
3. If the user has allergies, proactively flag menu items that contain those allergens.
4. When recommending restaurants, consider the user's dietary restrictions.
5. For reservations, you need: restaurant, date, time, and party size at minimum.
6. For orders, you need: restaurant, items with quantities, and order type (pickup/delivery).
7. When presenting time slots, show them in a readable format like "7:00 PM" not ISO strings.
8. Be helpful but never fabricate restaurant names, menu items, or prices — always use tools to look up real data.`;
}

// ── Main handler ──
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Auth: decode JWT payload (gateway already verified the signature via verify_jwt: true)
    // Using auth.getUser() fails on ES256-signed tokens in some supabase-js versions.
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return jsonRes({ error: "Missing authorization token" }, 401);

    const jwtPayload = decodeJwtPayload(token);
    const authUserId = jwtPayload?.sub as string | undefined;
    if (!authUserId) return jsonRes({ error: "Unauthorized" }, 401);

    // Look up user profile
    const { data: profile } = await supabaseAdmin
      .from("user_profiles")
      .select("id, full_name, email, phone, allergies, dietary_restrictions")
      .eq("auth_user_id", authUserId)
      .single();
    if (!profile) return jsonRes({ error: "User profile not found" }, 404);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return jsonRes({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    const body = await req.json();
    const { message, conversation_id, restaurant_id, language = "en" } = body;
    if (!message || typeof message !== "string")
      return jsonRes({ error: "message is required" }, 400);

    // Load restaurant context if provided
    let restaurantContext: { id: string; name: string; cuisine_type: string } | null = null;
    if (restaurant_id) {
      const { data: rest } = await supabaseAdmin
        .from("restaurants")
        .select("id, name, cuisine_type")
        .eq("id", restaurant_id)
        .single();
      restaurantContext = rest;
    }

    // Get or create conversation
    let convId = conversation_id;
    if (!convId) {
      const { data: conv, error: convErr } = await supabaseAdmin
        .from("chat_conversations")
        .insert({
          user_profile_id: profile.id,
          restaurant_id: restaurant_id || null,
          language,
        })
        .select("id")
        .single();
      if (convErr) return jsonRes({ error: `Conversation error: ${convErr.message}` }, 500);
      convId = conv.id;
    }

    // Save user message
    await supabaseAdmin.from("chat_messages").insert({
      conversation_id: convId,
      role: "user",
      content: message,
    });

    // Load conversation history (last 20 messages)
    const { data: history } = await supabaseAdmin
      .from("chat_messages")
      .select("role, content, metadata")
      .eq("conversation_id", convId)
      .order("created_at", { ascending: true })
      .limit(20);

    // Build Claude messages from history
    const claudeMessages: Anthropic.MessageParam[] = [];
    for (const msg of history || []) {
      if (msg.role === "user") {
        claudeMessages.push({ role: "user", content: msg.content });
      } else if (msg.role === "assistant") {
        claudeMessages.push({ role: "assistant", content: msg.content });
      } else if (msg.role === "tool_call" && msg.metadata) {
        // Tool use block from assistant
        claudeMessages.push({
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: msg.metadata.tool_use_id,
              name: msg.metadata.tool_name,
              input: msg.metadata.input,
            },
          ],
        });
      } else if (msg.role === "tool_result" && msg.metadata) {
        claudeMessages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: msg.metadata.tool_use_id,
              content: msg.content,
            },
          ],
        });
      }
    }

    // Call Claude with tool-use loop
    const anthropic = new Anthropic({ apiKey });
    const systemPrompt = buildSystemPrompt(profile, language, restaurantContext);
    const actionsTaken: { type: string; data: Record<string, any> }[] = [];
    let finalReply = "";
    let iterations = 0;
    const MAX_ITERATIONS = 5;

    let currentMessages = [...claudeMessages];

    while (iterations < MAX_ITERATIONS) {
      iterations++;
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: systemPrompt,
        tools: TOOLS,
        messages: currentMessages,
      });

      // Check if there are tool_use blocks
      const toolUseBlocks = response.content.filter(
        (b: any) => b.type === "tool_use",
      );
      const textBlocks = response.content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("");

      if (toolUseBlocks.length === 0) {
        // No tools, just text — we're done
        finalReply = textBlocks;
        break;
      }

      // Process each tool call
      const assistantContent = response.content;
      currentMessages.push({ role: "assistant", content: assistantContent as any });

      const toolResults: any[] = [];
      for (const block of toolUseBlocks) {
        const toolBlock = block as any;
        // Save tool_call to DB
        await supabaseAdmin.from("chat_messages").insert({
          conversation_id: convId,
          role: "tool_call",
          content: JSON.stringify(toolBlock.input),
          metadata: {
            tool_use_id: toolBlock.id,
            tool_name: toolBlock.name,
            input: toolBlock.input,
          },
        });

        // Execute the tool
        const result = await executeTool(toolBlock.name, toolBlock.input, profile.id);

        // Track actions
        const parsed = JSON.parse(result);
        if (parsed.success) {
          actionsTaken.push({ type: `${toolBlock.name}_completed`, data: parsed });
        }

        // Save tool_result to DB
        await supabaseAdmin.from("chat_messages").insert({
          conversation_id: convId,
          role: "tool_result",
          content: result,
          metadata: { tool_use_id: toolBlock.id },
        });

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolBlock.id,
          content: result,
        });
      }

      currentMessages.push({ role: "user", content: toolResults });

      // If this was the last iteration and Claude wanted to call more tools, capture text
      if (textBlocks && iterations === MAX_ITERATIONS) {
        finalReply = textBlocks;
      }
    }

    // Save assistant reply to DB
    if (finalReply) {
      await supabaseAdmin.from("chat_messages").insert({
        conversation_id: convId,
        role: "assistant",
        content: finalReply,
      });
    }

    // Update conversation title after first exchange
    if (!conversation_id && finalReply) {
      const title = message.length > 50 ? message.slice(0, 47) + "..." : message;
      await supabaseAdmin
        .from("chat_conversations")
        .update({ title, updated_at: new Date().toISOString() })
        .eq("id", convId);
    }

    return jsonRes({
      conversation_id: convId,
      reply: finalReply,
      actions_taken: actionsTaken,
    });
  } catch (err) {
    console.error("cenaiva-chat error:", err);
    return jsonRes({ error: String(err) }, 500);
  }
});
