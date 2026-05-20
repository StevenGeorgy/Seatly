import { useMemo, useState } from "react";

import {
  RestaurantPreviewModal,
  type RestaurantPreviewSummary,
} from "@/components/customer/RestaurantPreviewModal";
import { normalizeRestaurantDietaryTags } from "@/lib/restaurant-dietary-tags";
import type { WizardBasics } from "./wizardTypes";

type PreviewAsDinerButtonProps = {
  restaurantId: string | null;
  basics: WizardBasics | null;
  /** Brand color picked on Step 6. Null = use Cenaiva default in the
   *  preview. The modal applies this via applyRestaurantTheme on open. */
  themeColor: string | null;
  open: boolean;
  onClose: () => void;
};

function buildInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "RR";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function PreviewAsDinerButton({
  restaurantId,
  basics,
  themeColor,
  open,
  onClose,
}: PreviewAsDinerButtonProps) {
  const [favorite, setFavorite] = useState(false);

  const summary = useMemo<RestaurantPreviewSummary | null>(() => {
    if (!restaurantId || !basics) return null;
    return {
      id: restaurantId,
      name: basics.restaurantName || "Your restaurant",
      cuisine: basics.cuisineType || "Restaurant",
      price: "",
      area: basics.city || "",
      bookedToday: 0,
      slots: [],
      initials: buildInitials(basics.restaurantName || "Restaurant"),
      badge: "Preview",
      city: basics.city || "",
      features: [],
      dietaryTags: normalizeRestaurantDietaryTags(basics.dietaryTags),
      logoUrl: null,
      coverPhotoUrl: null,
      avgRating: null,
      totalReviews: 0,
    };
  }, [basics, restaurantId]);

  return (
    <RestaurantPreviewModal
      restaurant={open ? summary : null}
      favorite={favorite}
      partySize="2"
      previewBannerText="🔒 Preview only — diners can't see this yet"
      themeOverride={themeColor ? { primaryColor: themeColor } : null}
      onClose={onClose}
      onToggleFavorite={() => setFavorite((v) => !v)}
      onReserve={() => Promise.resolve()}
    />
  );
}
