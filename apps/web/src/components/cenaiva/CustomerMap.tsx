import { useCallback } from "react";
import Map, { Marker, NavigationControl } from "react-map-gl/maplibre";
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

  const visibleRestaurants = restaurants.filter((r) =>
    map.marker_restaurant_ids.length > 0
      ? map.marker_restaurant_ids.includes(r.id)
      : true,
  );

  const handleMarkerClick = useCallback(
    (r: Restaurant) => {
      dispatch({ type: "highlight_restaurant", restaurant_id: r.id });
    },
    [dispatch],
  );

  const defaultCenter = map.center ?? { lat: 43.6532, lng: -79.3832 }; // Toronto fallback

  return (
    <Map
      initialViewState={{
        latitude: defaultCenter.lat,
        longitude: defaultCenter.lng,
        zoom: map.zoom,
      }}
      latitude={map.center?.lat}
      longitude={map.center?.lng}
      zoom={map.zoom}
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
