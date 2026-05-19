import { useEffect, useMemo, useRef, useState } from "react";
import { MarkerClusterer, type Cluster, type Renderer } from "@googlemaps/markerclusterer";

import {
  CENAIVA_MAP_STYLES,
  getGoogleMapsLoadError,
  hasGoogleMapsApiKey,
  loadGoogleMaps,
  type GoogleMapsMarker,
  type GoogleMapsNamespace,
} from "@/lib/google-maps";
import type { Restaurant } from "@/hooks/useRestaurant";
import { useAssistantStore } from "@/components/cenaiva/AssistantStore";
import { useAssistant } from "@/components/cenaiva/AssistantProvider";
import { toUserFacingError } from "@/lib/errors";
import { normalizeRestaurantPriceLevel } from "@/lib/restaurant-price-level";

// Local lightweight slice of `google.maps.Map` we actually call. Mirrors the
// shape used in `DiscoverPage.tsx` so both consumers stay in lock-step.
type GoogleMapInstance = {
  panTo: (point: { lat: number; lng: number }) => void;
  setZoom: (zoom: number) => void;
  fitBounds: (
    bounds: unknown,
    padding?: number | { top: number; right: number; bottom: number; left: number },
  ) => void;
};

interface CustomerMapProps {
  restaurants: Restaurant[];
}

const DEFAULT_CENTER = { lat: 43.6532, lng: -79.3832 }; // Toronto fallback
const DEFAULT_ZOOM = 11;

// Restaurant pin — matches Discover/Promotions style.
// • priceLevel null → small gold circle marker
// • priceLevel 1–3 → gold-bordered dark pill with $/$$/$$$ text
// `active` is the brighter/larger variant used when a restaurant is selected.
function pinIconSvg({
  active,
  priceLevel,
}: {
  active: boolean;
  priceLevel: number | null;
}): { url: string; size: { width: number; height: number } } {
  const filterId = `s${active ? "a" : "d"}`;

  if (priceLevel == null) {
    const size = active ? 32 : 24;
    const cx = size / 2;
    const cy = size / 2;
    const r = active ? 11 : 8;
    const fill = active ? "#F5E6C8" : "#C9A84C";
    const stroke = active ? "#0A0A0A" : "rgba(10,10,10,0.6)";
    const strokeWidth = active ? 2 : 1.25;
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='0 0 ${size} ${size}'><defs><filter id='${filterId}' x='-50%' y='-50%' width='200%' height='200%'><feDropShadow dx='0' dy='2' stdDeviation='2' flood-color='#000000' flood-opacity='0.55'/></filter></defs><circle cx='${cx}' cy='${cy}' r='${r}' fill='${fill}' stroke='${stroke}' stroke-width='${strokeWidth}' filter='url(#${filterId})'/></svg>`;
    return {
      url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
      size: { width: size, height: size },
    };
  }

  const dollarCount = Math.min(Math.max(priceLevel, 1), 3);
  const dollars = "$".repeat(dollarCount);
  const fontSize = active ? 14 : 12;
  const padX = active ? 10 : 8;
  const height = active ? 28 : 22;
  const charWidth = fontSize * 0.65;
  const width = Math.round(dollars.length * charWidth + padX * 2);
  const fill = active ? "#F5E6C8" : "#0A0A0A";
  const textColor = active ? "#0A0A0A" : "#C9A84C";
  const stroke = active ? "#C9A84C" : "rgba(201,168,76,0.65)";
  const strokeWidth = active ? 2 : 1.25;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}' viewBox='0 0 ${width} ${height}'><defs><filter id='${filterId}' x='-50%' y='-50%' width='200%' height='200%'><feDropShadow dx='0' dy='2' stdDeviation='2' flood-color='#000000' flood-opacity='0.55'/></filter></defs><rect x='${strokeWidth / 2}' y='${strokeWidth / 2}' width='${width - strokeWidth}' height='${height - strokeWidth}' rx='${height / 2}' ry='${height / 2}' fill='${fill}' stroke='${stroke}' stroke-width='${strokeWidth}' filter='url(#${filterId})'/><text x='50%' y='50%' dominant-baseline='central' text-anchor='middle' font-family='ui-monospace, SFMono-Regular, Menlo, monospace' font-weight='700' font-size='${fontSize}' fill='${textColor}'>${dollars}</text></svg>`;
  return {
    url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    size: { width, height },
  };
}

function clusterIconSvg(count: number): { url: string; size: number } {
  const size = count >= 50 ? 56 : count >= 10 ? 48 : 40;
  const cx = size / 2;
  const cy = size / 2;
  const halo = size / 2 - 2;
  const r = size / 2 - 7;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='0 0 ${size} ${size}'><defs><filter id='cs' x='-50%' y='-50%' width='200%' height='200%'><feDropShadow dx='0' dy='2' stdDeviation='2.5' flood-color='#000000' flood-opacity='0.55'/></filter></defs><circle cx='${cx}' cy='${cy}' r='${halo}' fill='rgba(201,168,76,0.16)' stroke='rgba(245,230,200,0.35)' stroke-width='1.5'/><circle cx='${cx}' cy='${cy}' r='${r}' fill='#C9A84C' stroke='#0A0A0A' stroke-width='2' filter='url(#cs)'/></svg>`;
  return { url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, size };
}

export function CustomerMap({ restaurants }: CustomerMapProps) {
  const { state, dispatch } = useAssistantStore();
  const { map: mapState, booking } = state;
  const assistant = useAssistant();

  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<GoogleMapInstance | null>(null);
  const mapsRef = useRef<GoogleMapsNamespace | null>(null);
  const markersRef = useRef<GoogleMapsMarker[]>([]);
  const clustererRef = useRef<MarkerClusterer | null>(null);
  // Refs that mirror the latest voiceStatus + assistant so the marker click
  // handler reads the *current* values at click time. Using state directly in
  // the effect deps would force a full marker rebuild on every voice-status
  // change (listening → processing → speaking → idle), which flashes the map.
  const voiceStatusRef = useRef(state.voiceStatus);
  voiceStatusRef.current = state.voiceStatus;
  const assistantRef = useRef(assistant);
  assistantRef.current = assistant;
  // State mirror of mapRef readiness — refs don't trigger re-renders, so the
  // marker-sync effect below would never fire after async `loadGoogleMaps()`
  // resolves. This flag re-triggers that effect once the map is mounted.
  const [mapReady, setMapReady] = useState(false);

  const googleReady = hasGoogleMapsApiKey();
  // Surface map load + auth failures in UI instead of swallowing them. The
  // initial value reads any error already captured by an earlier loader call
  // (e.g. another <CustomerMap> on the page that already failed); the event
  // listener picks up gm_authFailure errors that fire post-load.
  const [loadError, setLoadError] = useState<string | null>(() => getGoogleMapsLoadError());
  useEffect(() => {
    const onError = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      const friendly = toUserFacingError(detail ?? null, "Google Maps failed to load.");
      setLoadError(friendly.message);
      console.error("[CustomerMap.authFailure]", friendly.code, friendly.technical ?? detail);
    };
    window.addEventListener("cenaiva:google-maps-error", onError);
    return () => window.removeEventListener("cenaiva:google-maps-error", onError);
  }, []);

  // Mappable subset — Google Maps cannot place a marker without a finite
  // (lat, lng). Filter once so the marker-sync effect below is O(visible).
  const mappableRestaurants = useMemo(
    () => restaurants.filter((r) => r.lat != null && r.lng != null),
    [restaurants],
  );

  const visibleRestaurants = useMemo(() => {
    const ids = mapState.marker_restaurant_ids ?? [];
    if (ids.length === 0) return mappableRestaurants;
    const allowed = new Set(ids);
    return mappableRestaurants.filter((r) => allowed.has(r.id));
  }, [mappableRestaurants, mapState.marker_restaurant_ids]);

  // ── Map init (once) ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!googleReady || !mapNodeRef.current) return;
    let cancelled = false;

    void loadGoogleMaps()
      .then((maps) => {
        if (cancelled || !mapNodeRef.current) return;
        mapsRef.current = maps;
        const initialCenter =
          mapState.center ??
          (mappableRestaurants[0]?.lat != null && mappableRestaurants[0]?.lng != null
            ? { lat: mappableRestaurants[0].lat, lng: mappableRestaurants[0].lng }
            : DEFAULT_CENTER);
        mapRef.current = new maps.Map(mapNodeRef.current, {
          center: initialCenter,
          zoom: mapState.zoom ?? DEFAULT_ZOOM,
          minZoom: 4,
          maxZoom: 18,
          disableDefaultUI: true,
          zoomControl: false,
          mapTypeControl: false,
          fullscreenControl: false,
          streetViewControl: false,
          clickableIcons: false,
          gestureHandling: "greedy",
          backgroundColor: "#0A0A0A",
          styles: CENAIVA_MAP_STYLES,
        }) as GoogleMapInstance;
        setMapReady(true);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        const friendly = toUserFacingError(err, "Google Maps failed to load.");
        setLoadError(friendly.message);
        console.error("[CustomerMap.load]", friendly.code, friendly.technical ?? err);
      });

    return () => {
      cancelled = true;
      if (clustererRef.current) {
        clustererRef.current.clearMarkers();
        clustererRef.current = null;
      }
      markersRef.current.forEach((marker) => marker.setMap(null));
      markersRef.current = [];
      mapRef.current = null;
      mapsRef.current = null;
      setMapReady(false);
    };
    // Initial center/zoom are read from state; subsequent state changes are
    // handled by the panTo effect below to avoid re-creating the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleReady]);

  // ── Pan/zoom on store-driven center change (orchestrator updates) ──────
  useEffect(() => {
    if (!mapState.center || !mapRef.current) return;
    mapRef.current.panTo({ lat: mapState.center.lat, lng: mapState.center.lng });
    if (mapState.zoom != null) mapRef.current.setZoom(mapState.zoom);
  }, [mapState.center, mapState.zoom]);

  // ── First-load auto-fit: when the orchestrator hasn't picked a center yet,
  // fit the viewport to every mappable restaurant so the user sees all pins
  // immediately (mirrors Discover/Promotions UX). Runs once per map mount.
  const didAutoFitRef = useRef(false);
  useEffect(() => {
    if (!mapReady || didAutoFitRef.current) return;
    if (mapState.center) {
      // Orchestrator already chose a focus point — don't override it.
      didAutoFitRef.current = true;
      return;
    }
    const maps = mapsRef.current;
    const map = mapRef.current;
    if (!maps || !map || visibleRestaurants.length === 0) return;
    if (visibleRestaurants.length === 1) {
      // Single point — fitBounds would over-zoom, so just pan + sensible zoom.
      const only = visibleRestaurants[0];
      if (only.lat != null && only.lng != null) {
        map.panTo({ lat: only.lat, lng: only.lng });
        map.setZoom(13);
      }
      didAutoFitRef.current = true;
      return;
    }
    const bounds = new maps.LatLngBounds();
    for (const r of visibleRestaurants) {
      if (r.lat != null && r.lng != null) {
        bounds.extend({ lat: r.lat, lng: r.lng });
      }
    }
    map.fitBounds(bounds, 64);
    didAutoFitRef.current = true;
  }, [mapReady, visibleRestaurants, mapState.center]);

  // ── Pan to selected restaurant after booking flow picks one ────────────
  const selectedRestaurant = booking.restaurant_id
    ? restaurants.find((r) => r.id === booking.restaurant_id)
    : null;
  useEffect(() => {
    if (
      !selectedRestaurant ||
      selectedRestaurant.lat == null ||
      selectedRestaurant.lng == null ||
      !mapRef.current
    ) {
      return;
    }
    mapRef.current.panTo({ lat: selectedRestaurant.lat, lng: selectedRestaurant.lng });
    mapRef.current.setZoom(15);
  }, [selectedRestaurant]);

  // ── Marker sync — full-rebuild with clusterer (matches Discover) ───────
  useEffect(() => {
    if (!mapReady) return;
    const maps = mapsRef.current;
    const map = mapRef.current as unknown as Parameters<GoogleMapsMarker["setMap"]>[0];
    if (!maps || !map) return;

    const highlightedId =
      mapState.highlighted_restaurant_id ?? booking.restaurant_id ?? null;

    // Tear down previous clusterer + markers.
    if (clustererRef.current) {
      clustererRef.current.clearMarkers();
      clustererRef.current = null;
    }
    markersRef.current.forEach((marker) => marker.setMap(null));

    // Build fresh markers for every visible restaurant.
    markersRef.current = visibleRestaurants
      .filter((r) => r.lat != null && r.lng != null)
      .map((r) => {
        const isActive = highlightedId === r.id;
        const { url, size } = pinIconSvg({
          active: isActive,
          priceLevel: normalizeRestaurantPriceLevel(r.price_range),
        });
        const marker = new maps.Marker({
          position: { lat: r.lat as number, lng: r.lng as number },
          title: r.name,
          icon: {
            url,
            scaledSize: new maps.Size(size.width, size.height),
            anchor: new maps.Point(size.width / 2, size.height / 2),
          },
          zIndex: isActive ? 999 : 1,
        });
        marker.addListener("click", () => {
          // Mirror RestaurantRail.handleSelect — pin click should start the
          // booking conversation just like clicking a restaurant card does.
          if (voiceStatusRef.current === "processing") return;
          dispatch({
            type: "PRESELECT_RESTAURANT",
            restaurant_id: r.id,
            restaurant_name: r.name,
          });
          dispatch({ type: "highlight_restaurant", restaurant_id: r.id });
          void assistantRef.current?.sendTranscript(`I want to book at ${r.name}`, {
            restaurantId: r.id,
          });
        });
        return marker;
      });

    const renderer: Renderer = {
      render: ({ count, position }: Cluster) => {
        const { url, size } = clusterIconSvg(count);
        return new maps.Marker({
          position,
          icon: {
            url,
            scaledSize: new maps.Size(size, size),
            anchor: new maps.Point(size / 2, size / 2),
          },
          label: {
            text: String(count),
            color: "#0a0907",
            fontWeight: "700",
            fontSize: count >= 50 ? "13px" : "12px",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          },
          zIndex: 1000 + count,
        }) as unknown as google.maps.Marker;
      },
    };

    clustererRef.current = new MarkerClusterer({
      map: map as unknown as google.maps.Map,
      markers: markersRef.current as unknown as google.maps.Marker[],
      renderer,
    });

    return () => {
      if (clustererRef.current) {
        clustererRef.current.clearMarkers();
        clustererRef.current = null;
      }
      markersRef.current.forEach((marker) => marker.setMap(null));
      markersRef.current = [];
    };
  }, [mapReady, visibleRestaurants, mapState.highlighted_restaurant_id, booking.restaurant_id, dispatch]);

  if (!googleReady) {
    return (
      <div className="flex size-full items-center justify-center bg-bg-elevated px-8 text-center text-sm text-text-secondary">
        Add VITE_GOOGLE_MAPS_API_KEY to the root .env and restart the dev server to enable Google Maps.
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex size-full flex-col items-center justify-center gap-2 bg-bg-elevated px-8 text-center text-sm text-text-secondary">
        <div className="font-medium text-text-primary">Map unavailable</div>
        <div className="text-xs">{loadError}</div>
      </div>
    );
  }

  return <div ref={mapNodeRef} className="size-full" />;
}
