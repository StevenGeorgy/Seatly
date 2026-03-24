import { useEffect, useState } from "react";

import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

// ---------------------------------------------------------------------------
// Mock fallback data — used when the DB returns nothing for a slug
// ---------------------------------------------------------------------------
const MOCK_RESTAURANTS: Record<string, Restaurant> = {
  "the-golden-fork": {
    id: "mock-r-1", name: "The Golden Fork", slug: "the-golden-fork",
    logo_url: null, cover_photo_url: null,
    cuisine_type: "French", description: "Classic French bistro serving refined seasonal dishes in an intimate candlelit setting. Executive Chef Pierre Dubois brings 20 years of Parisian kitchen experience to every plate.",
    address: "142 King St W", city: "Toronto", province: "ON", country: "CA",
    lat: 43.6476, lng: -79.3871, phone: "+1 416-555-0142", email: "reservations@goldenfork.ca",
    website: "https://goldenfork.ca", hours_json: null, settings_json: null,
    plan: "pro", is_active: true, timezone: "America/Toronto", currency: "cad",
    tax_rate: 0.13, deposit_policy_json: null, loyalty_config_json: null,
    stripe_account_id: null, stripe_onboarding_complete: null,
    avg_rating: 4.8, total_reviews: 312, price_range: 3,
    booking_advance_days: 30, cancellation_hours: 24, no_show_fee: 25,
    accepts_walkins: true, business_type: "restaurant",
  },
  "sakura-house": {
    id: "mock-r-2", name: "Sakura House", slug: "sakura-house",
    logo_url: null, cover_photo_url: null,
    cuisine_type: "Japanese", description: "Authentic Japanese cuisine featuring daily-imported fish for sashimi and sushi, alongside hearty ramen bowls and seasonal omakase menus.",
    address: "88 Queen St E", city: "Toronto", province: "ON", country: "CA",
    lat: 43.6510, lng: -79.3740, phone: "+1 416-555-0088", email: "hello@sakurahouse.ca",
    website: null, hours_json: null, settings_json: null,
    plan: "pro", is_active: true, timezone: "America/Toronto", currency: "cad",
    tax_rate: 0.13, deposit_policy_json: null, loyalty_config_json: null,
    stripe_account_id: null, stripe_onboarding_complete: null,
    avg_rating: 4.6, total_reviews: 481, price_range: 2,
    booking_advance_days: 14, cancellation_hours: 12, no_show_fee: null,
    accepts_walkins: true, business_type: "restaurant",
  },
  "brasserie-lumiere": {
    id: "mock-r-3", name: "Brasserie Lumière", slug: "brasserie-lumiere",
    logo_url: null, cover_photo_url: null,
    cuisine_type: "French", description: "A sun-drenched Montreal brasserie serving classic steak-frites, croque-monsieurs, and an exceptional selection of natural wines by the glass.",
    address: "350 Rue Saint-Denis", city: "Montreal", province: "QC", country: "CA",
    lat: 45.5168, lng: -73.5696, phone: "+1 514-555-0350", email: null,
    website: null, hours_json: null, settings_json: null,
    plan: "starter", is_active: true, timezone: "America/Toronto", currency: "cad",
    tax_rate: 0.1497, deposit_policy_json: null, loyalty_config_json: null,
    stripe_account_id: null, stripe_onboarding_complete: null,
    avg_rating: 4.7, total_reviews: 198, price_range: 3,
    booking_advance_days: 21, cancellation_hours: 12, no_show_fee: null,
    accepts_walkins: true, business_type: "restaurant",
  },
  "casa-fuego": {
    id: "mock-r-4", name: "Casa Fuego", slug: "casa-fuego",
    logo_url: null, cover_photo_url: null,
    cuisine_type: "Mexican", description: "Modern Mexican street food meets Toronto cool. Wood-fired tacos, mezcal cocktails, and a salsa bar that keeps the party going all night.",
    address: "210 Ossington Ave", city: "Toronto", province: "ON", country: "CA",
    lat: 43.6489, lng: -79.4197, phone: "+1 416-555-0210", email: null,
    website: null, hours_json: null, settings_json: null,
    plan: "starter", is_active: true, timezone: "America/Toronto", currency: "cad",
    tax_rate: 0.13, deposit_policy_json: null, loyalty_config_json: null,
    stripe_account_id: null, stripe_onboarding_complete: null,
    avg_rating: 4.4, total_reviews: 276, price_range: 2,
    booking_advance_days: 7, cancellation_hours: 6, no_show_fee: null,
    accepts_walkins: true, business_type: "restaurant",
  },
  "terra-verde": {
    id: "mock-r-5", name: "Terra Verde", slug: "terra-verde",
    logo_url: null, cover_photo_url: null,
    cuisine_type: "Italian", description: "Farm-to-table Italian in the heart of the College Street strip. House-made pastas, wood-fired pizzas, and a rotating menu that follows the seasons.",
    address: "77 College St", city: "Toronto", province: "ON", country: "CA",
    lat: 43.6595, lng: -79.4134, phone: "+1 416-555-0077", email: null,
    website: null, hours_json: null, settings_json: null,
    plan: "pro", is_active: true, timezone: "America/Toronto", currency: "cad",
    tax_rate: 0.13, deposit_policy_json: null, loyalty_config_json: null,
    stripe_account_id: null, stripe_onboarding_complete: null,
    avg_rating: 4.5, total_reviews: 389, price_range: 2,
    booking_advance_days: 14, cancellation_hours: 12, no_show_fee: null,
    accepts_walkins: true, business_type: "restaurant",
  },
  "harbour-grill": {
    id: "mock-r-6", name: "Harbour Grill", slug: "harbour-grill",
    logo_url: null, cover_photo_url: null,
    cuisine_type: "Seafood", description: "Upscale waterfront dining featuring the freshest Atlantic seafood, prime cuts, and an award-winning raw bar overlooking Toronto Harbour.",
    address: "1 Harbour Square", city: "Toronto", province: "ON", country: "CA",
    lat: 43.6410, lng: -79.3810, phone: "+1 416-555-0001", email: null,
    website: null, hours_json: null, settings_json: null,
    plan: "pro", is_active: true, timezone: "America/Toronto", currency: "cad",
    tax_rate: 0.13, deposit_policy_json: null, loyalty_config_json: null,
    stripe_account_id: null, stripe_onboarding_complete: null,
    avg_rating: 4.9, total_reviews: 156, price_range: 4,
    booking_advance_days: 30, cancellation_hours: 48, no_show_fee: 50,
    accepts_walkins: false, business_type: "restaurant",
  },
  "spice-route": {
    id: "mock-r-7", name: "Spice Route", slug: "spice-route",
    logo_url: null, cover_photo_url: null,
    cuisine_type: "Indian", description: "A journey through the flavors of India — from the tandoor ovens of Punjab to the coastal curries of Kerala. Fully halal and vegetarian-friendly.",
    address: "3025 Hurontario St", city: "Mississauga", province: "ON", country: "CA",
    lat: 43.5882, lng: -79.6391, phone: "+1 905-555-3025", email: null,
    website: null, hours_json: null, settings_json: null,
    plan: "starter", is_active: true, timezone: "America/Toronto", currency: "cad",
    tax_rate: 0.13, deposit_policy_json: null, loyalty_config_json: null,
    stripe_account_id: null, stripe_onboarding_complete: null,
    avg_rating: 4.3, total_reviews: 521, price_range: 2,
    booking_advance_days: 7, cancellation_hours: 6, no_show_fee: null,
    accepts_walkins: true, business_type: "restaurant",
  },
  "smoke-and-barrel": {
    id: "mock-r-9", name: "Smoke & Barrel", slug: "smoke-and-barrel",
    logo_url: null, cover_photo_url: null,
    cuisine_type: "BBQ", description: "Low-and-slow Texas-style BBQ in downtown Toronto. Brisket, ribs, and pulled pork smoked 12+ hours daily, with an extensive craft beer list.",
    address: "512 Adelaide St W", city: "Toronto", province: "ON", country: "CA",
    lat: 43.6449, lng: -79.4009, phone: "+1 416-555-0512", email: null,
    website: null, hours_json: null, settings_json: null,
    plan: "starter", is_active: true, timezone: "America/Toronto", currency: "cad",
    tax_rate: 0.13, deposit_policy_json: null, loyalty_config_json: null,
    stripe_account_id: null, stripe_onboarding_complete: null,
    avg_rating: 4.7, total_reviews: 633, price_range: 2,
    booking_advance_days: 7, cancellation_hours: 6, no_show_fee: null,
    accepts_walkins: true, business_type: "restaurant",
  },
};

export type Restaurant = {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  cover_photo_url: string | null;
  cuisine_type: string | null;
  description: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  hours_json: Record<string, unknown> | null;
  settings_json: Record<string, unknown> | null;
  plan: string;
  is_active: boolean;
  timezone: string;
  currency: string;
  tax_rate: number;
  deposit_policy_json: Record<string, unknown> | null;
  loyalty_config_json: Record<string, unknown> | null;
  stripe_account_id: string | null;
  stripe_onboarding_complete: boolean | null;
  avg_rating: number | null;
  total_reviews: number | null;
  price_range: number | null;
  booking_advance_days: number;
  cancellation_hours: number;
  no_show_fee: number | null;
  accepts_walkins: boolean | null;
  business_type: string | null;
};

export function useRestaurant(slugOrId?: string) {
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!slugOrId) {
      setRestaurant(null);
      setLoading(false);
      return;
    }

    if (!isSupabaseConfigured()) {
      setRestaurant(MOCK_RESTAURANTS[slugOrId] ?? null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      const client = getSupabaseBrowserClient();
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slugOrId);
      const column = isUuid ? "id" : "slug";
      const { data, error: qErr } = await client
        .from("restaurants")
        .select("*")
        .eq(column, slugOrId)
        .single();

      if (cancelled) return;
      if (qErr || !data) {
        // Fall back to mock data for development / demo
        const mock = MOCK_RESTAURANTS[slugOrId] ?? null;
        setRestaurant(mock);
        setError(mock ? null : new Error(qErr?.message ?? "Not found"));
      } else {
        setRestaurant(data as Restaurant);
      }
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [slugOrId]);

  return { restaurant, loading, error };
}
