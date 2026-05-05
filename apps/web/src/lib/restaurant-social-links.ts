import type { RestaurantSettings } from "@/hooks/useStaffRestaurants";

export type RestaurantSocialLink = {
  id: "website" | "instagram" | "facebook";
  href: string;
  labelKey: string;
};

export function restaurantSocialLinks(
  settingsJson?: RestaurantSettings | null,
  websiteFallback?: string | null,
): RestaurantSocialLink[] {
  const businessProfile = settingsJson?.businessProfile;
  const links: Array<RestaurantSocialLink | null> = [
    (businessProfile?.websiteUrl ?? websiteFallback)
      ? {
          id: "website",
          href: businessProfile?.websiteUrl ?? websiteFallback ?? "",
          labelKey: "restaurantSocial.website",
        }
      : null,
    businessProfile?.instagramUrl
      ? {
          id: "instagram",
          href: businessProfile.instagramUrl,
          labelKey: "restaurantSocial.instagram",
        }
      : null,
    businessProfile?.facebookUrl
      ? {
          id: "facebook",
          href: businessProfile.facebookUrl,
          labelKey: "restaurantSocial.facebook",
        }
      : null,
  ];

  return links.filter((link): link is RestaurantSocialLink => Boolean(link?.href));
}
