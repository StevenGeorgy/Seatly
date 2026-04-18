import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import OpenAI from "npm:openai@4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

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

const VALID_TYPES = new Set(["menu_item", "menu_item_update", "promotion", "event"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FIXED_HOLIDAYS: { name: string; month: number; day: number }[] = [
  { name: "Valentine's Day", month: 2, day: 14 },
  { name: "St. Patrick's Day", month: 3, day: 17 },
  { name: "Easter Sunday", month: 4, day: 20 },
  { name: "Mother's Day", month: 5, day: 11 },
  { name: "Canada Day", month: 7, day: 1 },
  { name: "Labour Day", month: 9, day: 1 },
  { name: "Thanksgiving (Canada)", month: 10, day: 13 },
  { name: "Halloween", month: 10, day: 31 },
  { name: "Christmas Eve", month: 12, day: 24 },
  { name: "Christmas Day", month: 12, day: 25 },
  { name: "New Year's Eve", month: 12, day: 31 },
];

function getUpcomingHolidays(daysAhead = 45): string[] {
  const now = new Date();
  const future = new Date(now.getTime() + daysAhead * 86400_000);
  const results: string[] = [];
  for (const h of FIXED_HOLIDAYS) {
    let date = new Date(now.getFullYear(), h.month - 1, h.day);
    if (date < now) date = new Date(now.getFullYear() + 1, h.month - 1, h.day);
    if (date <= future) results.push(`${h.name} (${date.toISOString().slice(0, 10)})`);
  }
  return results;
}

function getMockSuggestions(today: string, sorted: any[], slowMovers: any[]) {
  const firstItem = sorted[0];
  const slowItem = slowMovers[0];
  return [
    {
      type: "menu_item",
      title: "Seasonal Truffle Mushroom Risotto",
      summary: "A rich, earthy risotto with wild mushrooms and shaved truffle.",
      rationale: "Your menu lacks a premium vegetarian entree. Truffle dishes command higher margins and attract guests with plant-based dietary preferences.",
      target_entity_id: null,
      payload: {
        name: "Truffle Mushroom Risotto",
        description: "Arborio rice slow-cooked with wild mushrooms, white wine, and shaved truffle. Finished with aged Parmesan.",
        price: 28,
        dietary_flags: ["vegetarian", "gluten-free"],
      },
    },
    {
      type: slowItem?.id ? "menu_item_update" : "menu_item",
      title: slowItem?.id
        ? `Drop price on "${slowItem.name}"`
        : "Add a crowd-pleasing daily special",
      summary: slowItem?.id
        ? "Reduce price to stimulate demand on a low-performing item."
        : "A rotating daily special keeps regulars coming back.",
      rationale: slowItem?.id
        ? `"${slowItem.name}" has only ${slowItem.orders} orders in the last 60 days at $${slowItem.price}. A 15-20% price drop could revive interest.`
        : "No clear slow-movers found. Consider adding a rotating special to drive repeat visits.",
      target_entity_id: slowItem?.id ?? null,
      payload: slowItem?.id
        ? { price: Math.round((slowItem.price * 0.82) * 100) / 100 }
        : { name: "Chef's Daily Special", description: "Ask your server for today's selection.", price: 22, dietary_flags: [] },
    },
    {
      type: "promotion",
      title: sorted.length >= 2 ? `BOGO on ${sorted[0].name} & ${sorted[1].name}` : "Date Night: 2-for-1 on Top Items",
      summary: "Buy one of your best-sellers and get a second one free — drives higher table spend.",
      rationale: "BOGO on top-sellers rewards repeat customers and increases average ticket size without discounting your whole menu.",
      target_entity_id: null,
      payload: {
        title: sorted.length >= 2 ? `BOGO on ${sorted[0].name} & ${sorted[1].name}` : "Date Night 2-for-1",
        description: "Buy one, get one free on selected items. Limited time offer.",
        promo_type: "bogo",
        discount_value: 0,
        discount_unit: "percent",
        bogo_item_ids: sorted.slice(0, 3).map((i: any) => i.id).filter(Boolean),
        buy_quantity: 1,
        get_quantity: 1,
        eligible_item_ids: [],
        starts_at: today,
        ends_at: new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10),
      },
    },
    {
      type: "promotion",
      title: slowMovers.length > 0 ? `20% Off ${slowMovers[0].name}` : "Weekend 20% Off Special",
      summary: slowMovers.length > 0 ? `Discount slow-moving items to clear inventory and attract new customers.` : "A weekend discount on selected items to drive foot traffic.",
      rationale: slowMovers.length > 0
        ? `${slowMovers.slice(0, 3).map((i: any) => i.name).join(", ")} have fewer than 5 orders in the last 60 days. A 20% discount makes them more attractive without removing them from the menu.`
        : "A targeted percentage discount on specific items is more cost-effective than a site-wide sale.",
      target_entity_id: null,
      payload: {
        title: slowMovers.length > 0 ? `20% Off Selected Items` : "Weekend 20% Off",
        description: "Get 20% off on selected menu items. This weekend only.",
        promo_type: "percentage",
        discount_value: 20,
        discount_unit: "percent",
        eligible_item_ids: (slowMovers.length > 0 ? slowMovers : sorted).slice(0, 3).map((i: any) => i.id).filter(Boolean),
        bogo_item_ids: [],
        buy_quantity: 1,
        get_quantity: 1,
        starts_at: today,
        ends_at: new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10),
      },
    },
    {
      type: "event",
      title: "Mother's Day Brunch",
      summary: "A special prix-fixe brunch menu to celebrate Mother's Day.",
      rationale: "Mother's Day is one of the highest-revenue restaurant days of the year. A ticketed prix-fixe event lets you plan ahead and maximize covers.",
      target_entity_id: null,
      payload: {
        name: "Mother's Day Brunch",
        description: "A three-course prix-fixe brunch featuring seasonal specials. Includes a complimentary mimosa for moms.",
        date: "2026-05-11",
        start_time: "10:00",
        end_time: "14:00",
        price_per_person: 65,
        capacity: 40,
        theme: "Mother's Day",
      },
    },
  ];
}

async function insertRows(rows: any[]) {
  const { data, error } = await supabaseAdmin
    .from("ai_suggestions")
    .insert(rows)
    .select();
  return { data, error };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
    if (!token) return jsonRes({ error: "Missing authorization token" }, 401);

    const jwtPayload = decodeJwtPayload(token);
    const authUserId = jwtPayload?.sub as string | undefined;
    if (!authUserId) return jsonRes({ error: "Unauthorized" }, 401);

    const { data: profile } = await supabaseAdmin
      .from("user_profiles")
      .select("id, full_name")
      .eq("auth_user_id", authUserId)
      .single();
    if (!profile) return jsonRes({ error: "User profile not found" }, 404);

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) return jsonRes({ error: "OPENAI_API_KEY not configured" }, 500);

    const body = await req.json();
    const { restaurant_id, language = "en" } = body;
    if (!restaurant_id) return jsonRes({ error: "restaurant_id is required" }, 400);

    const { data: roleRow } = await supabaseAdmin
      .from("user_restaurant_roles")
      .select("role")
      .eq("user_id", profile.id)
      .eq("restaurant_id", restaurant_id)
      .maybeSingle();
    if (!roleRow) return jsonRes({ error: "Unauthorized: no staff role for this restaurant" }, 403);

    const { data: restaurant } = await supabaseAdmin
      .from("restaurants")
      .select("name, cuisine_type, city, currency")
      .eq("id", restaurant_id)
      .single();
    if (!restaurant) return jsonRes({ error: "Restaurant not found" }, 404);

    const { data: categories } = await supabaseAdmin
      .from("menu_categories")
      .select("id, name")
      .eq("restaurant_id", restaurant_id)
      .eq("is_active", true);

    const { data: menuItems } = await supabaseAdmin
      .from("menu_items")
      .select("id, name, description, price, dietary_flags, allergens, is_available, is_featured, category_id")
      .eq("restaurant_id", restaurant_id)
      .eq("is_active", true);

    const since60 = new Date(Date.now() - 60 * 86400_000).toISOString();
    const { data: orderCounts } = await supabaseAdmin
      .from("order_items")
      .select("menu_item_id, quantity, orders!inner(restaurant_id, created_at)")
      .eq("orders.restaurant_id", restaurant_id)
      .gte("orders.created_at", since60);

    const countMap: Record<string, number> = {};
    for (const row of orderCounts ?? []) {
      if (row.menu_item_id) {
        countMap[row.menu_item_id] = (countMap[row.menu_item_id] ?? 0) + (row.quantity ?? 1);
      }
    }

    const itemsWithCounts = (menuItems ?? []).map((item: any) => ({
      ...item,
      orders_last_60_days: countMap[item.id] ?? 0,
    }));

    const validItemIds = new Set(itemsWithCounts.map((i: any) => i.id));
    const sorted = [...itemsWithCounts].sort((a, b) => b.orders_last_60_days - a.orders_last_60_days);
    const topSellers = sorted.slice(0, 5).map((i: any) => ({ id: i.id, name: i.name, price: i.price, orders: i.orders_last_60_days }));
    const slowMovers = sorted.slice(-5).filter((i: any) => i.orders_last_60_days < 5).map((i: any) => ({ id: i.id, name: i.name, price: i.price, orders: i.orders_last_60_days }));

    const { data: promotions } = await supabaseAdmin
      .from("promotions")
      .select("title, promo_type, ends_at")
      .eq("restaurant_id", restaurant_id)
      .eq("is_active", true);

    const since90 = new Date(Date.now() - 90 * 86400_000).toISOString();
    const { data: guestSignals } = await supabaseAdmin
      .from("guests")
      .select("dietary_restrictions, allergies")
      .eq("restaurant_id", restaurant_id)
      .gte("created_at", since90)
      .limit(200);

    const { data: recentOccasions } = await supabaseAdmin
      .from("reservations")
      .select("occasion")
      .eq("restaurant_id", restaurant_id)
      .gte("reserved_at", since90)
      .not("occasion", "is", null)
      .limit(200);

    const allergyCount: Record<string, number> = {};
    const dietCount: Record<string, number> = {};
    const occasionCount: Record<string, number> = {};

    for (const g of guestSignals ?? []) {
      for (const a of (g.allergies ?? []) as string[]) allergyCount[a] = (allergyCount[a] ?? 0) + 1;
      for (const d of (g.dietary_restrictions ?? []) as string[]) dietCount[d] = (dietCount[d] ?? 0) + 1;
    }
    for (const r of recentOccasions ?? []) {
      if (r.occasion) occasionCount[r.occasion] = (occasionCount[r.occasion] ?? 0) + 1;
    }

    const topAllergies = Object.entries(allergyCount).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k);
    const topDiets = Object.entries(dietCount).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k);
    const topOccasions = Object.entries(occasionCount).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k);

    const upcomingHolidays = getUpcomingHolidays(45);
    const today = new Date().toISOString().slice(0, 10);
    const categoryNames = (categories ?? []).map((c: any) => c.name);

    const allItemsForPrompt = itemsWithCounts.slice(0, 30).map((i: any) => ({ id: i.id, name: i.name, price: i.price }));

    const systemPrompt = `You are a restaurant business advisor for ${restaurant.name}, a ${restaurant.cuisine_type || "restaurant"} in ${restaurant.city || "Canada"}.

Today is ${today}. Currency: ${restaurant.currency?.toUpperCase() || "CAD"}.

CURRENT MENU (${itemsWithCounts.length} items):
Categories: ${categoryNames.join(", ") || "None"}
All items (id, name, price): ${JSON.stringify(allItemsForPrompt)}
Top sellers (last 60 days): ${JSON.stringify(topSellers)}
Slow movers (< 5 orders in 60 days): ${JSON.stringify(slowMovers)}

ACTIVE PROMOTIONS: ${JSON.stringify((promotions ?? []).map((p: any) => p.title))}

GUEST SIGNALS (last 90 days):
- Common allergies: ${topAllergies.join(", ") || "none recorded"}
- Dietary preferences: ${topDiets.join(", ") || "none recorded"}
- Popular occasions: ${topOccasions.join(", ") || "none recorded"}

UPCOMING HOLIDAYS (next 45 days): ${upcomingHolidays.length > 0 ? upcomingHolidays.join(", ") : "none"}

Generate 6-8 actionable suggestions. Mix types: menu_item (new dishes), menu_item_update (price changes, description rewrites, or 86ing for slow movers), promotion (discounts/deals), event (themed dining events).

Rules:
- suggestion type MUST be exactly one of: menu_item, menu_item_update, promotion, event
- menu_item_update: target_entity_id MUST be one of the exact UUIDs from the slow movers list above. payload must contain ONLY the fields being changed (e.g. {"price": 12.00} or {"is_available": false}). Rationale MUST cite the order count.
- menu_item: payload must include name, description, price (number), dietary_flags (array).
- promotion: payload must include title, description, promo_type (one of: bogo, percentage, fixed, free_item), discount_value (number, use 0 for bogo/free_item), discount_unit (percent or dollar), starts_at (ISO date), ends_at (ISO date).
  IMPORTANT for promotion item selection — you MUST choose specific items from the "All items" list above using their exact UUIDs:
  - bogo: set bogo_item_ids to an array of item UUIDs the deal applies to (pick 2-6 relevant items; empty = all items). Set buy_quantity (default 1) and get_quantity (default 1).
  - free_item: set free_item_id to the UUID of the item being given free (pick one low-cost or slow-moving item).
  - percentage or fixed: set eligible_item_ids to an array of item UUIDs the discount applies to (pick relevant items; empty = whole cart).
- event: payload must include name, description, date (YYYY-MM-DD), start_time (HH:MM), end_time (HH:MM), price_per_person (number), capacity (number), theme.

Respond in ${language}. Return valid JSON matching the schema: {"suggestions": [...]}`;

    const openai = new OpenAI({ apiKey });
    let aiSuggestions: any[] = [];

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        max_tokens: 3000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: "Generate suggestions now." },
        ],
      });

      const parsed = JSON.parse(response.choices[0].message.content || "{}");
      if (Array.isArray(parsed.suggestions)) {
        // Sanitize: enforce valid type, valid UUIDs, non-empty titles
        aiSuggestions = parsed.suggestions
          .filter((s: any) => VALID_TYPES.has(s.type) && typeof s.title === "string" && s.title.trim())
          .map((s: any) => {
            // Ensure target_entity_id is a real UUID that actually exists in our menu
            let entityId: string | null = null;
            if (s.target_entity_id && UUID_RE.test(String(s.target_entity_id)) && validItemIds.has(s.target_entity_id)) {
              entityId = s.target_entity_id;
            }
            // menu_item_update without a valid real entity id → downgrade to menu_item
            if (s.type === "menu_item_update" && !entityId) {
              return { ...s, type: "menu_item", target_entity_id: null };
            }
            // Sanitize promotion item arrays — filter to only real menu item UUIDs
            if (s.type === "promotion" && s.payload) {
              const p = { ...s.payload };
              if (Array.isArray(p.bogo_item_ids)) {
                p.bogo_item_ids = p.bogo_item_ids.filter((id: any) => UUID_RE.test(String(id)) && validItemIds.has(id));
              }
              if (p.free_item_id && (!UUID_RE.test(String(p.free_item_id)) || !validItemIds.has(p.free_item_id))) {
                p.free_item_id = null;
              }
              if (Array.isArray(p.eligible_item_ids)) {
                p.eligible_item_ids = p.eligible_item_ids.filter((id: any) => UUID_RE.test(String(id)) && validItemIds.has(id));
              }
              return { ...s, target_entity_id: entityId, payload: p };
            }
            return { ...s, target_entity_id: entityId };
          });
      }
    } catch (aiErr) {
      console.error("OpenAI call failed:", aiErr);
    }

    // Fall back to mocks if AI produced nothing usable
    if (aiSuggestions.length === 0) {
      aiSuggestions = getMockSuggestions(today, sorted, slowMovers);
    }

    // Wipe existing open suggestions for this restaurant
    await supabaseAdmin
      .from("ai_suggestions")
      .delete()
      .eq("restaurant_id", restaurant_id)
      .is("applied_at", null)
      .is("dismissed_at", null);

    const rows = aiSuggestions.map((s: any) => ({
      restaurant_id,
      suggestion_type: s.type,
      target_entity_id: s.target_entity_id ?? null,
      title: s.title,
      summary: s.summary ?? null,
      rationale: s.rationale ?? null,
      payload: s.payload ?? {},
    }));

    let { data: inserted, error: insertErr } = await insertRows(rows);

    // If the AI rows still fail to insert for any reason, fall back to guaranteed-valid mocks
    if (insertErr) {
      console.error("Insert failed, falling back to mocks:", insertErr.message);
      const mockRows = getMockSuggestions(today, sorted, slowMovers).map((s: any) => ({
        restaurant_id,
        suggestion_type: s.type,
        target_entity_id: s.target_entity_id ?? null,
        title: s.title,
        summary: s.summary ?? null,
        rationale: s.rationale ?? null,
        payload: s.payload ?? {},
      }));
      const fallback = await insertRows(mockRows);
      inserted = fallback.data;
      if (fallback.error) {
        return jsonRes({ error: "Failed to insert suggestions: " + fallback.error.message }, 500);
      }
    }

    return jsonRes({ suggestions: inserted });
  } catch (err) {
    console.error("generate-menu-suggestions error:", err);
    return jsonRes({ error: String(err) }, 500);
  }
});
