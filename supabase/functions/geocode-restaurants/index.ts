import { corsHeaders } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "Seatly/1.0 (seatly.app)";

interface Restaurant {
  id: string;
  address: string | null;
  city: string | null;
  country: string | null;
}

async function geocodeAddress(address: string, city: string, country: string): Promise<{ lat: number; lng: number } | null> {
  const query = [address, city, country].filter(Boolean).join(", ");
  const url = `${NOMINATIM}?q=${encodeURIComponent(query)}&format=json&limit=1`;

  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) return null;

  const results = await res.json() as Array<{ lat: string; lon: string }>;
  if (!results.length) return null;

  return { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Single-restaurant mode: POST { restaurant_id }
    if (req.method === "POST") {
      const body = await req.json() as { restaurant_id?: string };

      if (body.restaurant_id) {
        const { data: r, error } = await supabaseAdmin
          .from("restaurants")
          .select("id, address, city, country")
          .eq("id", body.restaurant_id)
          .single();

        if (error || !r) {
          return new Response(JSON.stringify({ error: "Restaurant not found" }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const coords = await geocodeAddress(r.address ?? "", r.city ?? "", r.country ?? "");
        if (!coords) {
          return new Response(JSON.stringify({ error: "Could not geocode address" }), {
            status: 422,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        await supabaseAdmin
          .from("restaurants")
          .update({ lat: coords.lat, lng: coords.lng })
          .eq("id", body.restaurant_id);

        return new Response(JSON.stringify({ ok: true, ...coords }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Backfill mode: GET — geocodes all restaurants missing lat/lng, 1 req/s per Nominatim ToS
    const { data: restaurants, error } = await supabaseAdmin
      .from("restaurants")
      .select("id, address, city, country")
      .is("lat", null)
      .not("address", "is", null);

    if (error) throw error;

    const results: Array<{ id: string; ok: boolean; lat?: number; lng?: number }> = [];

    for (const r of (restaurants as Restaurant[]) ?? []) {
      const coords = await geocodeAddress(r.address ?? "", r.city ?? "", r.country ?? "");

      if (coords) {
        await supabaseAdmin
          .from("restaurants")
          .update({ lat: coords.lat, lng: coords.lng })
          .eq("id", r.id);
        results.push({ id: r.id, ok: true, ...coords });
      } else {
        results.push({ id: r.id, ok: false });
      }

      // Nominatim rate limit: 1 req/s
      await new Promise((resolve) => setTimeout(resolve, 1100));
    }

    return new Response(JSON.stringify({ geocoded: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
