import { useCallback, useEffect, useRef } from "react";
import Map, { Marker, NavigationControl, type MapRef } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Restaurant } from "@/hooks/useRestaurant";
import { useAssistantStore } from "@/components/cenaiva/AssistantStore";

const MAP_STYLE =
  import.meta.env.VITE_MAPLIBRE_STYLE_URL || "https://demotiles.maplibre.org/style.json";

interface CustomerMapProps {
  restaurants: Restaurant[];
}

export function CustomerMap({ restaurants }: CustomerMapProps) {
  const { state, dispatch } = useAssistantStore();
  const { map, booking } = state;
  const mapRef = useRef<MapRef>(null);
  const selectedRestaurant = booking.restaurant_id
    ? restaurants.find((restaurant) => restaurant.id === booking.restaurant_id)
    : null;

  // Fly to new center whenever the orchestrator updates map.center
  useEffect(() => {
    if (map.center && mapRef.current) {
      mapRef.current.flyTo({
        center: [map.center.lng, map.center.lat],
        zoom: map.zoom ?? 13,
        duration: 1200,
      });
    }
  }, [map.center, map.zoom]);

  useEffect(() => {
    if (selectedRestaurant?.lat == null || selectedRestaurant?.lng == null || !mapRef.current) return;
    mapRef.current.flyTo({
      center: [selectedRestaurant.lng, selectedRestaurant.lat],
      zoom: 15.5,
      duration: 1200,
    });
  }, [selectedRestaurant]);

  const markerIds = map.marker_restaurant_ids ?? [];
  const visibleRestaurants = restaurants.filter((r) =>
    markerIds.length > 0 ? markerIds.includes(r.id) : true,
  );

  const handleMarkerClick = useCallback(
    (r: Restaurant) => {
      dispatch({ type: "highlight_restaurant", restaurant_id: r.id });
    },
    [dispatch],
  );

  return (
    <Map
      ref={mapRef}
      initialViewState={{
        latitude: 43.6532,
        longitude: -79.3832,
        zoom: 11,
      }}
      style={{ width: "100%", height: "100%" }}
      mapStyle={MAP_STYLE}
      attributionControl={false}
    >
      <NavigationControl position="top-right" showCompass={false} />

      {visibleRestaurants
        .filter((r) => r.lat != null && r.lng != null)
        .map((r) => {
          const isHighlighted =
            map.highlighted_restaurant_id === r.id ||
            booking.restaurant_id === r.id;

          return (
            <Marker
              key={r.id}
              latitude={r.lat!}
              longitude={r.lng!}
              onClick={() => handleMarkerClick(r)}
            >
              <button
                className="group relative focus:outline-none"
                aria-label={r.name}
              >
                <span
                  className={`
                    flex items-center justify-center
                    px-2 py-1 rounded-full text-xs font-semibold whitespace-nowrap
                    shadow-md border transition-all duration-200
                    ${
                      isHighlighted
                        ? "bg-[#C8A951] text-black border-[#A68B3E] scale-110"
                        : "bg-[#1A1A1A] text-white border-white/20 group-hover:bg-[#C8A951] group-hover:text-black"
                    }
                  `}
                >
                  {r.name}
                </span>
              </button>
            </Marker>
          );
        })}
    </Map>
  );
}
