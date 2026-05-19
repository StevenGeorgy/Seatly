# Cenaiva Mobile Maps Integration Guide

Comprehensive reference for porting the web app's Google Maps look-and-feel to the React Native (Expo) mobile app at https://github.com/savyo777/mobile-seatly-v2.

The goal is **pixel-equivalent visual parity** with the web — same dark theme, same gold accents, same custom markers, same clustering behaviour, same address autocomplete on the owner side.

This doc is the single source of truth. Read top-to-bottom, follow Section 12's checklist, and you should have a working map in a few hours of focused work.

**Last updated:** 2026-05-18
**Web reference repo:** Seatly-12 (the repo this doc lives in)
**Mobile target repo:** https://github.com/savyo777/mobile-seatly-v2

---

## Table of contents

1. [Library choice](#section-1--library-choice)
2. [API key setup (Google Cloud Console)](#section-2--api-key-setup-google-cloud-console)
3. [The map style JSON](#section-3--the-map-style-json-most-important-section)
4. [Custom markers](#section-4--custom-markers)
5. [Map view configuration](#section-5--map-view-configuration)
6. [Marker interaction model](#section-6--marker-interaction-model)
7. [User location](#section-7--user-location)
8. [Geocoding (forward + reverse)](#section-8--geocoding-forward--reverse)
9. [Theme color tokens](#section-9--theme-color-tokens-one-stop-hex-reference)
10. [Typography](#section-10--typography)
11. [Loading state + error handling](#section-11--loading-state--error-handling)
12. [Step-by-step port checklist](#section-12--step-by-step-port-checklist)
13. [Files to read in the web repo](#section-13--files-to-read-in-the-web-repo)

---

## Section 1 — Library choice

**Recommended:** `react-native-maps` v1.18+ with `provider={PROVIDER_GOOGLE}`.

**Why:**
- Default Expo-supported Google Maps wrapper.
- Has Android + iOS native SDK underneath.
- Supports custom marker views (any React component can be a marker).
- Supports a `customMapStyle` prop that accepts the **same JSON shape** as the web's `CENAIVA_MAP_STYLES`. No translation required.
- Mature clustering library available: `react-native-map-clustering`.

**Reject `expo-maps`** for now. It's newer, less mature, and doesn't yet have parity on custom markers / clustering at the level we need.

### Install (run in the mobile repo)

```bash
npx expo install react-native-maps
npm install react-native-map-clustering
npx expo install expo-location
```

### Add to `app.json` plugins

```json
{
  "expo": {
    "plugins": [
      ["react-native-maps", {
        "androidGoogleMapsApiKey": "<ANDROID_KEY>",
        "iosGoogleMapsApiKey": "<IOS_KEY>"
      }]
    ]
  }
}
```

Then run `npx expo prebuild` to regenerate the `ios/` and `android/` native directories. The plugin auto-injects the keys into `AndroidManifest.xml` and `Info.plist`.

---

## Section 2 — API key setup (Google Cloud Console)

Web uses `VITE_GOOGLE_MAPS_API_KEY` (browser-restricted, in the root `.env`) and `GOOGLE_MAPS_SERVER_API_KEY` (used by edge functions). Mobile needs **two separate keys** — one Android, one iOS — because they have different bundle ID restrictions in the Google Cloud Console.

### Steps in the existing Cenaiva Google Cloud project

1. **APIs & Services → Library** — enable these four APIs:
   - **Maps SDK for Android**
   - **Maps SDK for iOS**
   - **Places API**
   - **Geocoding API**

2. **APIs & Services → Credentials → Create credentials → API key** — create two keys:
   - **"Cenaiva Mobile — Android"**
     - Application restriction: **Android apps**
     - Add the bundle ID + SHA-1 fingerprint of the mobile app
     - API restrictions: Maps SDK for Android, Places API, Geocoding API
   - **"Cenaiva Mobile — iOS"**
     - Application restriction: **iOS apps**
     - Add the bundle ID
     - API restrictions: Maps SDK for iOS, Places API, Geocoding API

3. Set them as Expo secrets:
   ```bash
   npx eas secret:create --scope project --name ANDROID_GOOGLE_MAPS_KEY --value <android-key>
   npx eas secret:create --scope project --name IOS_GOOGLE_MAPS_KEY --value <ios-key>
   ```
   Then reference them in `app.json` via `${ANDROID_GOOGLE_MAPS_KEY}` and `${IOS_GOOGLE_MAPS_KEY}`.

**Important:** Never commit the keys to git. Even browser-restricted keys can be abused if exposed.

---

## Section 3 — The map style JSON (most important section)

The web's style array is defined verbatim in `apps/web/src/lib/google-maps.ts` lines 8–52 as the exported constant `CENAIVA_MAP_STYLES`.

**Action:** Copy the **entire array byte-for-byte** into a new file `mobile/src/theme/cenaivaMapStyle.ts` and pass to `<MapView customMapStyle={CENAIVA_MAP_STYLES}>`. Google's Styled Map spec is identical for web + Android + iOS — no translation needed.

### Visual character of the style

| Element | Hex | Notes |
|---|---|---|
| Base geometry | `#0A0A0A` | Catch-all for unmapped areas |
| Water | `#0A1320` | Dark blue, lakes + rivers |
| Water labels | `#5C7088` | Muted blue text |
| Local roads fill | `#1A1A1A` | Side streets |
| Local road stroke | `#0A0A0A` | Hairline edge |
| Arterial fill | `#242424` | Mid-tier roads |
| Highway fill | `#2E2E2E` | Major roads |
| Highway labels | `#C9A84C` | **Gold** |
| Road labels (other) | `#888888` | Muted gray |
| Administrative boundaries | `#2E2E2E` | Country/state/city lines |
| Country / locality labels | `#F5E6C8` | Light gold (city names) |
| Neighborhood labels | `#C9A84C` | Gold |
| Landscape (man-made) fill | `#242424` | Plazas, paved areas |
| Landscape (man-made) stroke | `#A8873A` | Dark gold, 0.6px hairline |
| Landscape (natural) | `#0F0F0F` | Open natural areas |
| Terrain | `#121412` | Hills, mountains (darkest tier) |
| POI parks geometry | `#0F1A12` | Dark green-tinted |
| POI park labels | `#A8873A` | Dark gold |
| POI business labels | `#AAAAAA` | Generic POI text |

### Hidden POI types

These are set to `visibility: off` in the style:
- Medical
- School
- Government
- Place of worship
- Sports complex
- Road icons (the little turn-by-turn pins)
- Transit (bus stops, subway stations)
- POI map icons (storefronts, etc.)

The intent is a clean, low-noise map where the only visual focus is the restaurants we add via custom markers.

### Light / dark theme

**There is no light theme.** Cenaiva is dark-first across web and (will be) mobile. Don't bother building a light variant unless the product changes direction.

---

## Section 4 — Custom markers

The web renders four marker variants via runtime-generated SVG data URIs. On mobile, each variant is implemented as a React Native `<Marker>` with a custom child `<View>` (react-native-maps lets us put any React component inside a marker).

### 4.1 Restaurant circle marker (idle)

```
┌──────────────────────────┐
│  • 22px circle           │
│  • Fill: #C9A84C (gold)  │
│  • Border: rgba(10,10,10,│
│            0.6), 1.25px  │
│  • Drop shadow:          │
│    color #000            │
│    offset (0, 2)         │
│    opacity 0.55          │
│    radius 2              │
│    elevation 4 (Android) │
└──────────────────────────┘
```

React Native styling:
```js
{
  width: 22,
  height: 22,
  borderRadius: 11,
  backgroundColor: '#C9A84C',
  borderWidth: 1.25,
  borderColor: 'rgba(10, 10, 10, 0.6)',
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.55,
  shadowRadius: 2,
  elevation: 4,
}
```

### 4.2 Restaurant circle marker (active / selected)

```
┌────────────────────────────┐
│  • 28px circle             │
│  • Fill: #F5E6C8 (gold-lt) │
│  • Border: #0A0A0A, 2px    │
│  • Same shadow as 4.1      │
└────────────────────────────┘
```

### 4.3 Restaurant price badge marker (when `priceLevel` 1–3 is set)

A horizontal pill with `$`, `$$`, or `$$$` text.

**Idle state:**
- 22px tall, dynamic width (about 12px per `$` character)
- Fill: `#0A0A0A` (black)
- Border: `rgba(201, 168, 76, 0.65)`, 1.25px (gold, semi-transparent)
- Text: `$` / `$$` / `$$$` in `#C9A84C`, monospace, weight 700, 12px

**Active state:**
- 28px tall
- Fill: `#F5E6C8`
- Border: `#C9A84C`, 2px
- Text: `#0A0A0A`, 14px

### 4.4 User location marker

Show the user's current position with a distinct blue dot.

```
┌──────────────────────────────┐
│  • 16px solid circle         │
│  • Fill: #3B82F6 (blue)      │
│  • Border: #BFDBFE, 4px      │
│    (lighter blue halo)       │
└──────────────────────────────┘
```

Two implementation options on React Native:
- **Option A (preferred):** Use the built-in `<MapView showsUserLocation={true} userLocationAnnotationTitle="" />` and rely on the native blue-dot. Set `showsMyLocationButton={false}` to hide the FAB.
- **Option B:** Render a custom `<Marker>` at the user's lat/lng with the styling above. Use this if Option A's native styling doesn't match well enough.

### 4.5 Cluster markers (when 2+ restaurants are within cluster radius)

Three size tiers based on count:

| Item count | Diameter |
|---:|---:|
| 1–9 | 40px |
| 10–49 | 48px |
| 50+ | 56px |

**Visual structure:**
- Outer halo ring: `rgba(201, 168, 76, 0.16)` (very faint gold wash), border 1.5px
- Inner circle: `#C9A84C` (solid gold), border `#0A0A0A` 2px
- Count label centered: monospace, weight 700, color `#0A0907` (near-black), 12px (or 13px for the 50+ tier)
- Drop shadow on the inner circle (same params as 4.1)

Use `react-native-map-clustering`'s `renderCluster` prop to draw these.

### Z-index stacking rules

Match the web's marker z-order:
- Idle markers: `zIndex={1}`
- Active / hovered markers: `zIndex={999}` (always on top of idle)
- Clusters: `zIndex={1000 + count}` (clusters always topmost, larger clusters topmost-most)

---

## Section 5 — Map view configuration

These props on `<MapView>` mirror the web's `new google.maps.Map(...)` config.

```jsx
<MapView
  provider={PROVIDER_GOOGLE}
  customMapStyle={CENAIVA_MAP_STYLES}
  showsCompass={false}
  showsMyLocationButton={false}
  showsTraffic={false}
  showsBuildings={false}
  showsPointsOfInterest={false}      // matches web's clickableIcons=false
  toolbarEnabled={false}              // Android only — hides directions toolbar
  minZoomLevel={4}
  maxZoomLevel={18}
  initialRegion={{
    latitude:  userLat  ?? firstRestaurant?.lat  ?? 43.6532,   // Toronto fallback
    longitude: userLng  ?? firstRestaurant?.lng  ?? -79.3832,
    latitudeDelta:  0.1,                                       // ≈ web zoom 11
    longitudeDelta: 0.1,
  }}
  style={{ flex: 1, backgroundColor: '#0A0A0A' }}
/>
```

### Web → mobile config equivalents

| Web setting | Mobile equivalent | Notes |
|---|---|---|
| `disableDefaultUI: true` | `showsCompass={false} showsMyLocationButton={false} toolbarEnabled={false}` | Disable the lot |
| `clickableIcons: false` | `showsPointsOfInterest={false}` | Hide tappable Google POIs |
| `minZoom: 4 / maxZoom: 18` | `minZoomLevel={4} maxZoomLevel={18}` | Identical |
| `gestureHandling: "greedy"` | n/a | Native default behaviour is fine |
| `backgroundColor: "#0A0A0A"` | Parent `<View>` `backgroundColor` | Pre-tile-load state |
| `mapTypeControl: false` | n/a (no mobile equivalent control) | — |
| `streetViewControl: false` | n/a | — |
| `fullscreenControl: false` | n/a | — |
| `zoomControl: false` | n/a | — |

### Default center & zoom

The web's logic:
- If user location available → center on user's lat/lng, zoom 13.
- Else if restaurants list non-empty → center on the first restaurant.
- Final fallback → Toronto `43.6532, -79.3832`, zoom 11.

Mobile should match.

### Zoom on selection (CustomerMap pattern)

When the user taps a restaurant card or the assistant highlights a restaurant, the web animates the map to pan to the restaurant + zoom to 15.

Mobile equivalent:
```js
mapRef.current?.animateToRegion(
  {
    latitude: restaurant.lat,
    longitude: restaurant.lng,
    latitudeDelta: 0.01,   // ≈ zoom 15
    longitudeDelta: 0.01,
  },
  500, // ms
);
```

---

## Section 6 — Marker interaction model

Web flow: marker click → calls `onSelect(restaurantId)` callback → parent component updates state → side panel opens. Marker **does NOT open a Google InfoWindow popup** — the web actively suppresses default InfoWindow styling via CSS in `index.css`.

### Mobile equivalent

```jsx
<Marker
  coordinate={{ latitude: r.lat, longitude: r.lng }}
  onPress={() => onSelect(r.id)}
  zIndex={selectedId === r.id ? 999 : 1}
>
  <RestaurantMarkerView restaurant={r} active={selectedId === r.id} />
</Marker>
```

**Do NOT use the native callout** (`<Marker title=... description=...>`) — that triggers the iOS/Android default popup, which doesn't match the web's UX.

Instead, on select:
- Either navigate to the restaurant detail screen, or
- Slide up a bottom sheet (the mobile-native equivalent to the web's side panel).

### Map background tap

The web treats a tap on empty map area as "deselect" — `onPress` on `<MapView>` should set selectedId back to null.

```jsx
<MapView
  ...props
  onPress={() => setSelectedId(null)}
/>
```

### Cluster tap

The web zooms into a cluster's bounding box on tap. Mobile equivalent:
```jsx
<ClusterMarker
  onPress={(cluster) => {
    mapRef.current?.fitToCoordinates(
      cluster.markers.map((m) => m.coordinate),
      { edgePadding: { top: 80, bottom: 80, left: 80, right: 80 }, animated: true },
    );
  }}
/>
```

---

## Section 7 — User location

Web uses `navigator.geolocation.getCurrentPosition()`. Mobile uses `expo-location`.

### Permission + fetch pattern

```js
import * as Location from 'expo-location';

const { status } = await Location.requestForegroundPermissionsAsync();
if (status === 'granted') {
  const loc = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });
  setUserLocation({
    lat: loc.coords.latitude,
    lng: loc.coords.longitude,
  });
}
```

### Behavior parity with web

| State | Behavior |
|---|---|
| Permission granted | Center map on user, zoom 13, drop user marker (Section 4.4), reverse-geocode for header city label (Section 8) |
| Permission denied | Center on first restaurant or Toronto fallback, zoom 11, no user marker |
| Permission pending | Show map with default region while waiting; don't block UI |

### Header city label

The web displays a "MONDAY · MAY 18 · GUELPH" style label in the Discover header where the last segment is derived from reverse-geocoding the user's location. See Section 8.

### Required permissions in `app.json`

```json
{
  "expo": {
    "ios": {
      "infoPlist": {
        "NSLocationWhenInUseUsageDescription":
          "Cenaiva uses your location to show nearby restaurants and personalize recommendations."
      }
    },
    "android": {
      "permissions": ["ACCESS_COARSE_LOCATION", "ACCESS_FINE_LOCATION"]
    }
  }
}
```

---

## Section 8 — Geocoding (forward + reverse)

Two geocoding flows exist in the web app.

### 8.1 Reverse geocoding — header city label

The web calls `google.maps.Geocoder().geocode({ location: { lat, lng } })` at `apps/web/src/pages/customer/DiscoverPage.tsx` lines 1362–1373, then picks the first `locality` or `administrative_area_level_2` component for the header city label.

**Mobile equivalent (preferred — uses the OS, no API quota):**

```js
const places = await Location.reverseGeocodeAsync({
  latitude: lat,
  longitude: lng,
});
const city = places[0]?.city ?? places[0]?.subregion ?? null;
```

If you need server-side parity (Google's Geocoding API), call it directly with the iOS / Android API key:

```js
const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${KEY}`;
const res = await fetch(url);
const data = await res.json();
// data.results[].address_components → find locality
```

### 8.2 Forward geocoding — address autocomplete (owner side)

The web uses `google.maps.places.Autocomplete` in `apps/web/src/components/restaurant/GoogleAddressAutocompleteInput.tsx` for the restaurant owner's address input on the setup wizard. Restricted to `types: ["address"]`.

**Mobile equivalent:** Use [`react-native-google-places-autocomplete`](https://github.com/FaridSafi/react-native-google-places-autocomplete) — a maintained library.

```jsx
import { GooglePlacesAutocomplete } from 'react-native-google-places-autocomplete';

<GooglePlacesAutocomplete
  placeholder="142 King St W"
  query={{
    key: GOOGLE_KEY,
    language: 'en',
    types: 'address',
  }}
  fetchDetails={true}
  GooglePlacesDetailsQuery={{
    fields: 'address_components,formatted_address,geometry,place_id',
  }}
  onPress={(data, details = null) => {
    const parsed = parseGooglePlace(details);
    setAddress(parsed);
  }}
/>
```

### Parsed address shape

Match the web's `parseGooglePlace()` output (defined in `apps/web/src/lib/google-maps.ts` lines 202–225):

```ts
{
  address:    string;        // street_number + ' ' + route
  city:       string;        // "locality"
  province:   string;        // "administrative_area_level_1"
  country:    string;        // "country"
  postalCode: string;        // "postal_code"
  placeId:    string;
  lat:        number | null;
  lng:        number | null;
}
```

---

## Section 9 — Theme color tokens (one-stop hex reference)

These are extracted from `apps/web/src/index.css` (CSS variables) and `packages/tokens/`. Put them in `mobile/src/theme/colors.ts` — the mobile dev should be able to copy this table directly into the file.

### Primary palette

| Token | Hex | Used by |
|---|---|---|
| `bgBase` | `#0A0A0A` | Map background, page container |
| `bgSurface` | `#1A1A1A` | Card backgrounds, modals, popovers |
| `bgElevated` | `#242424` | Elevated surfaces, error/loading state |
| `gold` | `#C9A84C` | Marker fill (idle), highway labels, brand accent |
| `goldLight` | `#F5E6C8` | Marker fill (active), country/locality labels |
| `goldDark` | `#A8873A` | Landscape strokes, POI park labels |
| `textPrimary` | `#FFFFFF` | Headings, primary text, active marker labels |
| `textSecondary` | `#AAAAAA` | Road labels, secondary text |
| `textMuted` | `#666666` | Tertiary text, helpers |
| `border` | `#2E2E2E` | Admin boundaries, dividers, input outlines |

### Map-specific extras

| Token | Hex | Used by |
|---|---|---|
| `userBlue` | `#3B82F6` | User location marker fill |
| `userBlueLight` | `#BFDBFE` | User location marker border |
| `waterFill` | `#0A1320` | Map water bodies |
| `waterLabel` | `#5C7088` | Water name labels |
| `parkFill` | `#0F1A12` | Map park areas |

### Semantic / status

| Token | Hex | Used by |
|---|---|---|
| `success` | `#22C55E` | Confirmed bookings, "Seated" status |
| `warning` | `#F59E0B` | "Arriving" status, time-sensitive alerts |
| `danger` | `#EF4444` | Errors, cancellations, "Overdue" status |
| `info` | `#3B82F6` | "Reserved" status, informational |

### Floor plan (admin/staff side)

These are hardcoded muted backgrounds for table states in the floor plan editor — not derivable from the primary palette.

| State | Fill | Border |
|---|---|---|
| Empty | `#2A2A2A` | `#404040` |
| Seated | `#1A3A1A` | `#2A4A2A` |
| Arriving | `#3A3000` | `#4A4000` |
| Overdue | `#3A1A1A` | `#4A2A2A` |
| Reserved | `#1A1A3A` | `#2A2A4A` |

### Important note on the "gold" value

There's a known discrepancy in the web monorepo:
- `apps/web/src/index.css` and `apps/web/src/lib/google-maps.ts` use `#C9A84C`.
- `packages/tokens/theme.native.ts` defines `#D4AF37` (classical gold).

**Use `#C9A84C` for the mobile port.** This matches the web pixel-for-pixel. The `theme.native.ts` value is a partial / older draft that wasn't updated when the web brand consolidated on `#C9A84C`.

---

## Section 10 — Typography

### Font families

Web (via Google Fonts CDN + npm):

| Role | Font | Source | Weights |
|---|---|---|---|
| Serif (headings) | **Fraunces** variable | Google Fonts | 400, 500, 600, 700 (variable axis) |
| Sans (body) | **Geist Variable** | npm `@fontsource-variable/geist` | variable |
| Mono | **JetBrains Mono** | Google Fonts | 400, 500 |

### Mobile equivalents

Install via Expo Google Fonts:

```bash
npx expo install expo-font @expo-google-fonts/fraunces @expo-google-fonts/jetbrains-mono
```

Geist on mobile is trickier — `@expo-google-fonts/geist` may not exist depending on Expo SDK version. Falls back gracefully to:
- iOS: System default (San Francisco) — close enough visually
- Android: Roboto

Load fonts in your root component:

```jsx
import { useFonts, Fraunces_400Regular, Fraunces_600SemiBold, Fraunces_700Bold } from '@expo-google-fonts/fraunces';
import { JetBrainsMono_400Regular, JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono';

const [fontsLoaded] = useFonts({
  Fraunces_400Regular, Fraunces_600SemiBold, Fraunces_700Bold,
  JetBrainsMono_400Regular, JetBrainsMono_500Medium,
});
```

### Marker label font

Web uses `ui-monospace`. On mobile:
```js
import { Platform } from 'react-native';
const monoFont = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });
```

This gives you the closest visual match to the web's monospace marker labels.

### Sizes / weights / spacing

| Token | Value | Use |
|---|---|---|
| `text.xs` | 12px | Labels, badges, helper text |
| `text.sm` | 14px | Secondary text, captions |
| `text.base` | 16px | Body text |
| `text.lg` | 18px | Subheadings |
| `text.xl` | 20px | Section headings |
| `text.2xl` | 24px | Page titles |
| `text.3xl` | 30px | Hero text |
| `weight.normal` | `400` | |
| `weight.medium` | `500` | |
| `weight.semibold` | `600` | |
| `weight.bold` | `700` | |

### Spacing scale (4px baseline)

| Token | px |
|---|---:|
| `xs` | 4 |
| `sm` | 8 |
| `md` | 12 |
| `lg` | 16 |
| `xl` | 24 |
| `2xl` | 32 |
| `3xl` | 48 |
| `4xl` | 64 |

### Border radius

| Token | px |
|---|---:|
| `sm` | 4 |
| `md` | 8 |
| `lg` | 12 |
| `xl` | 16 |
| `full` | 9999 |

---

## Section 11 — Loading state + error handling

### Web behavior

- If `VITE_GOOGLE_MAPS_API_KEY` is missing → renders a div with `bg-bg-elevated` background and the message:
  > "Add VITE_GOOGLE_MAPS_API_KEY to the root .env and restart the dev server to enable Google Maps."
- If the global `gm_authFailure` callback fires (auth/quota/restriction error) → the same div with:
  > "Google Maps auth failed. Check the API key, HTTP-referrer restrictions in Google Cloud Console, and that the Maps JavaScript API + Places API are enabled with billing."

### Mobile equivalent

1. Wrap `<MapView>` in an ErrorBoundary so a render crash shows a fallback view instead of a white screen.
2. Detect missing API key at startup. Read from `expo-constants` or `Constants.expoConfig.extra` and render a fallback view before mounting `<MapView>`.
3. Use the `onError` prop on `<MapView>` to catch native init failures (typically thrown when the key is invalid or the API isn't enabled). Render an overlay with a "Maps unavailable — check API key" message.

```jsx
<MapView
  ...props
  onError={(error) => {
    console.error('Map init failed:', error);
    setMapError(error.message);
  }}
/>
{mapError && <MapErrorOverlay message={mapError} />}
```

### Fallback view style

```jsx
<View style={{
  flex: 1,
  backgroundColor: '#242424',  // bgElevated
  justifyContent: 'center',
  alignItems: 'center',
  padding: 24,
}}>
  <Text style={{ color: '#FFFFFF', fontSize: 18, fontFamily: 'Fraunces_600SemiBold' }}>
    Maps unavailable
  </Text>
  <Text style={{ color: '#AAAAAA', fontSize: 14, marginTop: 8, textAlign: 'center' }}>
    {mapError ?? 'Check that the Google Maps API key is configured.'}
  </Text>
</View>
```

---

## Section 12 — Step-by-step port checklist

```
☐ 1. Get the two API keys from Google Cloud Console (Android + iOS)
☐ 2. Set them as Expo secrets (ANDROID_GOOGLE_MAPS_KEY, IOS_GOOGLE_MAPS_KEY)
☐ 3. Install dependencies in mobile repo:
       npx expo install react-native-maps expo-location
       npm install react-native-map-clustering
☐ 4. Install fonts:
       npx expo install expo-font @expo-google-fonts/fraunces @expo-google-fonts/jetbrains-mono
☐ 5. Add the react-native-maps plugin block to app.json with the keys
☐ 6. Run `npx expo prebuild` (generates ios/ and android/ native dirs)
☐ 7. Copy CENAIVA_MAP_STYLES verbatim from
     apps/web/src/lib/google-maps.ts (lines 8–52) →
     mobile/src/theme/cenaivaMapStyle.ts
☐ 8. Build the theme/colors.ts file using Section 9's hex tables
☐ 9. Implement <RestaurantMarker> custom-view component using Section 4
     (idle and active variants, plus price-badge variant when priceLevel set)
☐ 10. Implement <ClusterMarker> custom-view component using Section 4.5
☐ 11. Wire up <MapView> with the props in Section 5
☐ 12. Add expo-location permission flow + user-marker overlay (Section 7)
☐ 13. Add reverse geocoding for the header city label (Section 8.1)
☐ 14. Add Places autocomplete for owner address input (Section 8.2)
☐ 15. Add ErrorBoundary + onError handler (Section 11)
☐ 16. Test on iOS Simulator + Android Emulator with a known location
      (e.g., Toronto 43.6532,-79.3832) and verify visual match against the web
☐ 17. Take screenshots side-by-side with web at the same zoom level
      and check tile colors, marker positions, label fonts visually match
☐ 18. Test on a real device for both platforms (simulators sometimes lie
      about font rendering and shadow appearance)
```

---

## Section 13 — Files to read in the web repo

For reference and cross-check, the mobile dev will want to open these files in this repo:

| File | Why |
|---|---|
| `apps/web/src/lib/google-maps.ts` | Loader, `CENAIVA_MAP_STYLES` constant (lines 8–52), `parseGooglePlace()` (lines 202–225) |
| `apps/web/src/components/cenaiva/CustomerMap.tsx` | The simplest map implementation — voice-shell map with restaurant markers |
| `apps/web/src/pages/customer/DiscoverPage.tsx` | Most complex map — clustering, price-badge markers, user location, reverse geocoding (lines 1362–1373) |
| `apps/web/src/pages/customer/DealsPage.tsx` | Map with event markers — similar pattern to DiscoverPage |
| `apps/web/src/components/restaurant/GoogleAddressAutocompleteInput.tsx` | Address autocomplete reference implementation |
| `apps/web/src/index.css` | CSS variables for the color tokens (the source of truth for `--gold`, `--bg-base`, etc.) |
| `packages/tokens/theme.native.ts` | Existing partial mobile theme — note it uses `#D4AF37` for gold which is the WRONG value; use `#C9A84C` instead |

---

## Section 14 — Visual parity sanity check

After implementing, do this side-by-side comparison before considering the port done:

1. Open the web app's `/discover` page in Chrome at desktop width, location set to Toronto.
2. Open the mobile app on iOS Simulator at iPhone 15 Pro size, location set to Toronto.
3. Take a screenshot of each at the same zoom level.
4. Open them side by side and check:
   - ✅ Map tile colors match (water, roads, terrain)
   - ✅ Marker positions match for the same restaurants
   - ✅ Marker colors match (gold idle, light-gold active)
   - ✅ Price badges look identical (same `$` characters, same fonts)
   - ✅ Cluster bubbles look identical (same gold halo, same count font)
   - ✅ User location dot is identical blue
   - ✅ Header city label matches
   - ✅ Background color matches in the loading-state fallback

If anything differs, the discrepancy is in one of: the map style JSON (Section 3), a marker style (Section 4), or a color token (Section 9). Re-check those sections.

---

## Appendix — Quick reference card

For the mobile dev to pin near their monitor:

```
GOLD              #C9A84C
GOLD LIGHT        #F5E6C8
GOLD DARK         #A8873A
BG BASE           #0A0A0A
BG SURFACE        #1A1A1A
BG ELEVATED       #242424
TEXT PRIMARY      #FFFFFF
TEXT SECONDARY    #AAAAAA
BORDER            #2E2E2E
USER BLUE         #3B82F6

MARKER IDLE       22px circle, fill #C9A84C, border rgba(10,10,10,0.6)/1.25px
MARKER ACTIVE     28px circle, fill #F5E6C8, border #0A0A0A/2px
USER MARKER       16px circle, fill #3B82F6, border #BFDBFE/4px
CLUSTER (1-9)     40px, halo rgba(201,168,76,0.16)/1.5px, fill #C9A84C, border #0A0A0A/2px
CLUSTER (10-49)   48px, same style
CLUSTER (50+)     56px, same style

MAP MIN ZOOM      4
MAP MAX ZOOM      18
DEFAULT ZOOM      11 (no user location), 13 (with user location)
SELECT ZOOM       15 (when a restaurant is tapped/highlighted)
FALLBACK CENTER   43.6532, -79.3832 (Toronto)

FONT SERIF        Fraunces (Google Fonts)
FONT MONO         JetBrains Mono (Google Fonts) → Menlo on iOS, monospace on Android
FONT SANS         Geist (or system default)
```

---

**End of guide.** If anything is unclear after reading this, the question is probably worth a 10-minute chat with the web team — but expect the answer to be "look in section N of this doc." This is the source of truth.
