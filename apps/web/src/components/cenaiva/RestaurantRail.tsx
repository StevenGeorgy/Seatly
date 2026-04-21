import { useRef } from "react";
import { motion } from "framer-motion";
import { Star, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Restaurant } from "@/hooks/useRestaurant";
import { useAssistantStore } from "@/components/cenaiva/AssistantStore";
import { useAssistant } from "@/components/cenaiva/AssistantProvider";

const CUISINE_EMOJI: Record<string, string> = {
  italian: "🍝", japanese: "🍣", mexican: "🌮", french: "🥐",
  indian: "🍛", thai: "🍜", seafood: "🦞", bbq: "🔥",
  chinese: "🥢", american: "🍔", greek: "🫒",
};

interface RestaurantRailProps {
  restaurants: Restaurant[];
}

export function RestaurantRail({ restaurants }: RestaurantRailProps) {
  const { state, dispatch } = useAssistantStore();
  const assistant = useAssistant();
  const railRef = useRef<HTMLDivElement>(null);

  const { map, booking } = state;

  const markerIds = map.marker_restaurant_ids ?? [];
  const visible = markerIds.length > 0
    ? restaurants.filter((r) => markerIds.includes(r.id))
    : restaurants;

  if (!visible.length) return null;

  const handleSelect = (r: Restaurant) => {
    // Guard: ignore taps while the orchestrator is already processing a request.
    // The active mic is stopped inside AssistantProvider.sendTranscript — calling
    // voice.stopListening() from here would target a different hook instance's
    // refs and leave Chrome's actual SpeechRecognition running.
    if (state.voiceStatus === "processing") return;
    dispatch({ type: "highlight_restaurant", restaurant_id: r.id });
    void assistant?.sendTranscript(`I want to book at ${r.name}`, { restaurantId: r.id });
  };

  return (
    <div ref={railRef} className="flex gap-3 overflow-x-auto px-4 py-2 scrollbar-none">
      {visible.map((r) => {
        const isSelected = booking.restaurant_id === r.id || map.highlighted_restaurant_id === r.id;
        const emoji = CUISINE_EMOJI[r.cuisine_type?.toLowerCase() ?? ""] ?? "🍽️";

        return (
          <motion.button
            key={r.id}
            onClick={() => handleSelect(r)}
            className={cn(
              "flex-shrink-0 w-52 rounded-xl overflow-hidden text-left",
              "border transition-all duration-200",
              isSelected
                ? "border-[#C8A951] shadow-[0_0_12px_rgba(200,169,81,0.3)]"
                : "border-white/10 hover:border-white/30",
              "bg-[#141414]",
            )}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            {/* Photo or gradient */}
            <div className="relative h-28 overflow-hidden">
              {r.cover_photo_url ? (
                <img
                  src={r.cover_photo_url}
                  alt={r.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-[#1E1E1E] text-4xl">
                  {emoji}
                </div>
              )}
              {isSelected && (
                <div className="absolute inset-0 bg-[#C8A951]/10 border-b border-[#C8A951]" />
              )}
            </div>

            <div className="p-2">
              <p className="text-white text-sm font-medium truncate">{r.name}</p>
              <div className="flex items-center gap-2 mt-0.5">
                {r.avg_rating && (
                  <span className="flex items-center gap-0.5 text-[#C8A951] text-xs">
                    <Star className="w-3 h-3 fill-current" />
                    {r.avg_rating.toFixed(1)}
                  </span>
                )}
                {r.city && (
                  <span className="flex items-center gap-0.5 text-white/50 text-xs">
                    <MapPin className="w-3 h-3" />
                    {r.city}
                  </span>
                )}
              </div>
              {r.cuisine_type && (
                <p className="text-white/40 text-xs mt-0.5">{r.cuisine_type}</p>
              )}
            </div>
          </motion.button>
        );
      })}
    </div>
  );
}
