# Maps And Location Integration Plan

## Goal

Add real map-based discovery so diners can find restaurants near them, and give restaurant owners a reliable address flow that stores usable coordinates for map search.

## APIs Needed

- Google Maps JavaScript API
  - Renders the customer-facing interactive map.
  - Enable it in Google Cloud Console: https://console.cloud.google.com/google/maps-apis

- Google Places API
  - Powers address and postal-code autocomplete for restaurant owners.
  - Use it when owners enter or update the restaurant address.

- Google Geocoding API
  - Converts a selected/saved address into latitude and longitude.
  - Use it server-side when saving or backfilling restaurant addresses.

- Browser Geolocation API
  - Built into the browser as `navigator.geolocation`.
  - No API key is required.
  - Use it to ask diners for permission to find restaurants near their current location.

## Key Setup

1. Create or select a project in Google Cloud Console.
2. Enable billing for the project.
3. Enable Google Maps JavaScript API, Google Places API, and Google Geocoding API.
4. Create API keys in Google Cloud Console under APIs & Services -> Credentials.
5. Use separate keys for browser and server usage:
   - `VITE_GOOGLE_MAPS_API_KEY` for the web app.
   - `GOOGLE_MAPS_SERVER_API_KEY` for Supabase Edge Functions.
6. Restrict the browser key by HTTP referrer.
7. Restrict the server key by API and, where possible, server environment.

## Implementation Outline

### Customer Discovery

- Ask diners for location permission when they enter the discovery/map experience.
- If permission is granted, center the map on the diner location and query nearby restaurants.
- If permission is denied, show a manual city/postal-code search fallback.
- Display restaurants as map pins and keep the map selection synced with the restaurant list.
- Keep diner location in frontend state by default; do not permanently store it unless a later user preference requires it.

### Restaurant Owner Address Flow

- Replace free-text-only address entry with Google Places autocomplete in onboarding and restaurant settings.
- Let owners search by full address or postal code.
- Save normalized address fields plus coordinates:
  - `address`
  - `city`
  - `province` or state
  - `country`
  - `postal_code`
  - `place_id`
  - `lat`
  - `lng`
- Show a small map preview before saving so the owner can confirm the location.
- Re-geocode when the saved address changes.

### Supabase Data And Search

- Keep the existing `restaurants.lat` and `restaurants.lng` columns for compatibility.
- Add `postal_code` and `place_id`.
- Add a PostGIS `location` column later if nearby search needs to scale beyond simple latitude/longitude filtering.
- Create a nearby restaurant query or Edge Function that accepts diner latitude, longitude, and search radius.

## Testing Scenarios

- Diner allows location and sees nearby restaurants sorted by distance.
- Diner denies location and can still search by city or postal code.
- Restaurant owner enters an address and sees autocomplete suggestions.
- Saved restaurant address stores latitude and longitude.
- Updated restaurant address refreshes coordinates.
- Restaurant pins open the existing restaurant preview and booking flow.

## Notes

- Supabase does not need a plan upgrade just to use Postgres or PostGIS.
- Google Maps APIs require billing enabled in Google Cloud.
- The existing `geocode-restaurants` Edge Function uses OpenStreetMap Nominatim; for production address reliability, prefer Google Geocoding with a server-side key.
