import { useEffect, useMemo, useRef, useState } from "react";

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
import { toUserFacingError } from "@/lib/errors";

// Local lightweight slice of `google.maps.Map` we actually call. Mirrors the
// shape used in `DiscoverPage.tsx` so both consumers stay in lock-step.
type GoogleMapInstance = {
  panTo: (point: { lat: number; lng: number }) => void;
  setZoom: (zoom: number) => void;
};

type CenaivaMarkerEntry = {
  id: string;
  marker: GoogleMapsMarker;
  listener: { remove: () => void };
};

interface CustomerMapProps {
  restaurants: Restaurant[];
}

const DEFAULT_CENTER = { lat: 43.6532, lng: -79.3832 }; // Toronto fallback
const DEFAULT_ZOOM = 11;

function pinIconSvg(active: boolean): { url: string; size: { width: number; height: number } } {
  // Restaurant name pill rendered as an SVG so we can swap the active style
  // imperatively without re-creating the marker. Selected = gold fill +
  // black text; idle = dark fill + white text.
  const fill = active ? "#C8A951" : "#1A1A1A";
  const stroke = active ? "#A68B3E" : "rgba(255,255,255,0.2)";
  const textColor = active ? "#0A0A0A" : "#FFFFFF";
  const strokeWidth = active ? 2 : 1;
  const radius = 14;
  // The actual width is variable per label; we render a circle here and let
  // the `label` option on the Marker draw the name. Keeping the icon to a
  // fixed-size circle avoids the Google Maps SDK fighting with custom SVG
  // text positioning on retina screens.
  const size = active ? 28 : 22;
  const cx = size / 2;
  const cy = size / 2;
  const r = active ? 11 : 8;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='0 0 ${size} ${size}'>
    <defs>
      <filter id='cenaiva-shadow' x='-50%' y='-50%' width='200%' height='200%'>
        <feDropShadow dx='0' dy='2' stdDeviation='2' flood-color='#000000' flood-opacity='0.55'/>
      </filter>
    </defs>
    <circle cx='${cx}' cy='${cy}' r='${r}' fill='${fill}' stroke='${stroke}' stroke-width='${strokeWidth}' filter='url(#cenaiva-shadow)'/>
  </svg>`;
  void textColor;
  void radius;
  return {
    url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    size: { width: size, height: size },
  };
}

export function CustomerMap({ restaurants }: CustomerMapProps) {
  const { state, dispatch } = useAssistantStore();
  const { map: mapState, booking } = state;

  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<GoogleMapInstance | null>(null);
  const mapsRef = useRef<GoogleMapsNamespace | null>(null);
  const markersRef = useRef<Map<string, CenaivaMarkerEntry>>(new Map());

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
    // Capture the marker map ref locally so the cleanup runs against the
    // same Map instance that this effect populated, even if a future render
    // swaps the ref. (react-hooks/exhaustive-deps wants this pattern.)
    const markerEntries = markersRef.current;

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
      })
      .catch((err: Error) => {
        if (cancelled) return;
        const friendly = toUserFacingError(err, "Google Maps failed to load.");
        setLoadError(friendly.message);
        console.error("[CustomerMap.load]", friendly.code, friendly.technical ?? err);
      });

    return () => {
      cancelled = true;
      // Drop markers on unmount so a remount doesn't leak the previous set.
      for (const entry of markerEntries.values()) {
        entry.listener.remove();
        entry.marker.setMap(null);
      }
      markerEntries.clear();
      mapRef.current = null;
      mapsRef.current = null;
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

  // ── Marker sync — diff visibleRestaurants against the existing set ─────
  useEffect(() => {
    const maps = mapsRef.current;
    const map = mapRef.current as unknown as Parameters<GoogleMapsMarker["setMap"]>[0];
    if (!maps || !map) return;

    const highlightedId =
      mapState.highlighted_restaurant_id ?? booking.restaurant_id ?? null;
    const visibleIds = new Set(visibleRestaurants.map((r) => r.id));

    // Remove markers that are no longer visible.
    for (const [id, entry] of markersRef.current) {
      if (visibleIds.has(id)) continue;
      entry.listener.remove();
      entry.marker.setMap(null);
      markersRef.current.delete(id);
    }

    // Add/update visible markers.
    for (const r of visibleRestaurants) {
      if (r.lat == null || r.lng == null) continue;
      const isActive = highlightedId === r.id;
      const icon = pinIconSvg(isActive);
      const labelColor = isActive ? "#0A0A0A" : "#FFFFFF";
      const existing = markersRef.current.get(r.id);

      if (existing) {
        // Marker already present — refresh icon + label to reflect highlight
        // changes. Casting because our slim type only exposes setMap; the
        // actual google.maps.Marker has setIcon/setLabel.
        const m = existing.marker as GoogleMapsMarker & {
          setIcon?: (icon: Record<string, unknown>) => void;
          setLabel?: (label: Record<string, unknown> | string | null) => void;
        };
        m.setIcon?.({
          url: icon.url,
          scaledSize: new maps.Size(icon.size.width, icon.size.height),
          anchor: new maps.Point(icon.size.width / 2, icon.size.height / 2),
        });
        m.setLabel?.({
          text: r.name,
          color: labelColor,
          fontSize: "12px",
          fontWeight: "600",
          className: "cenaiva-map-label",
        });
        continue;
      }

      const marker = new maps.Marker({
        position: { lat: r.lat, lng: r.lng },
        map,
        title: r.name,
        label: {
          text: r.name,
          color: labelColor,
          fontSize: "12px",
          fontWeight: "600",
          className: "cenaiva-map-label",
        },
        icon: {
          url: icon.url,
          scaledSize: new maps.Size(icon.size.width, icon.size.height),
          anchor: new maps.Point(icon.size.width / 2, icon.size.height / 2),
        },
        zIndex: isActive ? 100 : 1,
      });

      const listener = marker.addListener("click", () => {
        dispatch({ type: "highlight_restaurant", restaurant_id: r.id });
      });

      markersRef.current.set(r.id, { id: r.id, marker, listener });
    }
  }, [visibleRestaurants, mapState.highlighted_restaurant_id, booking.restaurant_id, dispatch]);

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
