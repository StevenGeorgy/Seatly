// Restaurant snapshot helper. Returns a compact JSON card with every piece of
// info Cenaiva voice could be asked about a restaurant — hours, address,
// dietary, top reviews, events, promotions, deposit policy, menu highlights.
//
// Used by `get_restaurant_snapshot` tool in cenaiva-orchestrate. Pattern C
// from the rebuild plan: stuff the data into context instead of building one
// tool per question type.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface RestaurantSnapshot {
  id: string;
  name: string;
  slug: string | null;
  cuisine_type: string | null;
  business_type: string | null;
  description: string | null;
  price_range: 1 | 2 | 3 | null;
  avg_rating: number | null;
  total_reviews: number;
  // Location
  address: string | null;
  city: string | null;
  province: string | null;
  country: string | null;
  timezone: string | null;
  lat: number | null;
  lng: number | null;
  // Contact
  phone: string | null;
  email: string | null;
  website: string | null;
  // Hours — JSON passed through; voice will format from it
  hours_json: unknown;
  // Capacity / booking rules
  accepts_walkins: boolean | null;
  has_bar: boolean | null;
  booking_advance_days: number | null;
  // Policies
  no_show_fee: number | null;
  deposit_tiers: Array<{ min_party_size: number; amount_per_person_cents: number }> | null;
  // settings_json optional fields — null when not populated
  dietary_tags: string[] | null;
  dress_code: string | null;
  parking: string | null;
  social_links: Record<string, string> | null;
  // Joined data
  top_reviews: Array<{
    rating: number;
    review_text: string | null;
    created_at: string;
  }>;
  active_events: Array<{
    id: string;
    name: string;
    theme: string | null;
    date: string;
    start_time: string | null;
    end_time: string | null;
    price_per_person: number | null;
    description: string | null;
  }>;
  active_promotions: Array<{
    id: string;
    title: string;
    description: string | null;
    promo_type: string | null;
    discount_value: number | null;
    discount_unit: string | null;
    promo_code: string | null;
    ends_at: string | null;
  }>;
  featured_menu_items: Array<{
    id: string;
    name: string;
    category: string | null;
    price: number;
    description: string | null;
    dietary_flags: string[] | null;
    spice_level: string | null;
  }>;
  // Meta
  fetched_at: string;
  cache_hit: boolean;
}

type SnapshotError = { error: string; status: number };

const SNAPSHOT_CACHE = new Map<string, { snapshot: RestaurantSnapshot; expiresAt: number }>();
// Snapshot freshness window. Dropped from 5min → 30s on 2026-05-18 so
// owner-side edits (hours change, menu update, deposit policy tweak) become
// visible to Cenaiva voice/text within seconds rather than minutes. The
// trade-off is ~10× more cache misses for the same restaurant, which is
// negligible at current scale and still saves the re-fetch within a single
// conversational turn.
const SNAPSHOT_TTL_MS = 30 * 1000;
const MAX_CACHE_ENTRIES = 200;

function readSettingsField<T>(settingsJson: unknown, key: string): T | null {
  if (!settingsJson || typeof settingsJson !== "object") return null;
  const v = (settingsJson as Record<string, unknown>)[key];
  return v === undefined ? null : (v as T);
}

export async function getRestaurantSnapshot(
  supabaseAdmin: SupabaseClient,
  restaurantId: string,
): Promise<RestaurantSnapshot | SnapshotError> {
  if (!restaurantId || typeof restaurantId !== "string") {
    return { error: "restaurant_id is required", status: 400 };
  }

  const cached = SNAPSHOT_CACHE.get(restaurantId);
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.snapshot, cache_hit: true };
  }

  const { data: r, error: rErr } = await supabaseAdmin
    .from("restaurants")
    .select(
      `
      id, name, slug, cuisine_type, business_type, description, price_range,
      avg_rating, total_reviews, address, city, province, country, timezone,
      lat, lng, phone, email, website, hours_json, settings_json,
      accepts_walkins, has_bar, booking_advance_days,
      no_show_fee, deposit_tiers, is_published, is_active
    `,
    )
    .eq("id", restaurantId)
    .maybeSingle();

  if (rErr) {
    console.warn("[restaurant-snapshot] base fetch failed:", rErr.message);
    return { error: "Failed to load restaurant", status: 500 };
  }
  if (!r) return { error: "Restaurant not found", status: 404 };
  if (!r.is_published || !r.is_active) {
    return { error: "Restaurant not currently available", status: 404 };
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();

  const [reviewsRes, eventsRes, promosRes, menuRes] = await Promise.all([
    supabaseAdmin
      .from("restaurant_reviews")
      .select("rating, review_text, created_at")
      .eq("restaurant_id", restaurantId)
      .not("review_text", "is", null)
      .order("rating", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(3),
    supabaseAdmin
      .from("events")
      .select("id, name, theme, date, start_time, end_time, price_per_person, description")
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true)
      .eq("is_private", false)
      .gte("date", todayIso)
      .order("date", { ascending: true })
      .limit(5),
    supabaseAdmin
      .from("promotions")
      .select(
        "id, title, description, promo_type, discount_value, discount_unit, promo_code, ends_at",
      )
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true)
      .eq("is_private", false)
      .or(`ends_at.is.null,ends_at.gt.${nowIso}`)
      .limit(5),
    supabaseAdmin
      .from("menu_items")
      .select(
        "id, name, category, price, description, dietary_flags, spice_level, sort_order",
      )
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true)
      .eq("is_available", true)
      .eq("is_featured", true)
      .order("sort_order", { ascending: true })
      .limit(6),
  ]);

  const snapshot: RestaurantSnapshot = {
    id: r.id,
    name: r.name,
    slug: r.slug ?? null,
    cuisine_type: r.cuisine_type ?? null,
    business_type: r.business_type ?? null,
    description: r.description ?? null,
    price_range: (r.price_range as 1 | 2 | 3 | null) ?? null,
    avg_rating: r.avg_rating ?? null,
    total_reviews: r.total_reviews ?? 0,
    address: r.address ?? null,
    city: r.city ?? null,
    province: r.province ?? null,
    country: r.country ?? null,
    timezone: r.timezone ?? null,
    lat: r.lat ?? null,
    lng: r.lng ?? null,
    phone: r.phone ?? null,
    email: r.email ?? null,
    website: r.website ?? null,
    hours_json: r.hours_json ?? null,
    accepts_walkins: r.accepts_walkins ?? null,
    has_bar: r.has_bar ?? null,
    booking_advance_days: r.booking_advance_days ?? null,
    no_show_fee: r.no_show_fee ?? null,
    deposit_tiers: (r.deposit_tiers as RestaurantSnapshot["deposit_tiers"]) ?? null,
    dietary_tags: readSettingsField<string[]>(r.settings_json, "dietaryTags"),
    dress_code: readSettingsField<string>(r.settings_json, "dressCode"),
    parking: readSettingsField<string>(r.settings_json, "parking"),
    social_links: readSettingsField<Record<string, string>>(r.settings_json, "socialLinks"),
    top_reviews: reviewsRes.data ?? [],
    active_events: eventsRes.data ?? [],
    active_promotions: promosRes.data ?? [],
    featured_menu_items: menuRes.data ?? [],
    fetched_at: nowIso,
    cache_hit: false,
  };

  SNAPSHOT_CACHE.set(restaurantId, {
    snapshot,
    expiresAt: Date.now() + SNAPSHOT_TTL_MS,
  });

  if (SNAPSHOT_CACHE.size > MAX_CACHE_ENTRIES) {
    const oldestKey = SNAPSHOT_CACHE.keys().next().value;
    if (oldestKey) SNAPSHOT_CACHE.delete(oldestKey);
  }

  return snapshot;
}
