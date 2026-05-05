import type { ComponentType, SVGProps } from "react";
import { Globe } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { RestaurantSettings } from "@/hooks/useStaffRestaurants";
import { restaurantSocialLinks } from "@/lib/restaurant-social-links";
import { cn } from "@/lib/utils";

type RestaurantSocialLinksProps = {
  settingsJson?: RestaurantSettings | null;
  websiteFallback?: string | null;
  className?: string;
  linkClassName?: string;
  iconClassName?: string;
};

function InstagramIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <rect x="2" y="2" width="20" height="20" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <path d="M17.5 6.5h.01" />
    </svg>
  );
}

function FacebookIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
    </svg>
  );
}

const SOCIAL_ICONS: Record<"website" | "instagram" | "facebook", ComponentType<SVGProps<SVGSVGElement>>> = {
  website: Globe,
  instagram: InstagramIcon,
  facebook: FacebookIcon,
};

export function RestaurantSocialLinks({
  settingsJson,
  websiteFallback,
  className,
  linkClassName,
  iconClassName,
}: RestaurantSocialLinksProps) {
  const { t } = useTranslation();
  const links = restaurantSocialLinks(settingsJson, websiteFallback);
  if (links.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {links.map(({ id, href, labelKey }) => {
        const Icon = SOCIAL_ICONS[id];
        return (
          <a
            key={id}
            href={href}
            target="_blank"
            rel="noreferrer"
            aria-label={t(labelKey)}
            title={t(labelKey)}
            className={cn(
              "inline-flex size-9 items-center justify-center rounded-full border border-border bg-bg-elevated text-text-secondary transition-colors hover:border-gold/50 hover:text-gold",
              linkClassName,
            )}
          >
            <Icon className={cn("size-4", iconClassName)} />
          </a>
        );
      })}
    </div>
  );
}
